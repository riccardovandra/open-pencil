/**
 * The editor inside an UP Docs page (`?host=up-docs&parent=<origin>`). The page owns the
 * document: it sends the `.fig` bytes and the automation bridge's address, and stores every save
 * (the `.fig` bytes and a picture of the page on screen). Messages come only from `window.parent`
 * at the parent origin and go only to it (`./channel.ts`). Every message is `{ type, ... }`:
 *
 *   editor -> host  `up-designer:ready`    { protocol: 1, version }
 *   host -> editor  `up-designer:load`     { bytes: ArrayBuffer | null, name?, socketURL? }
 *   editor -> host  `up-designer:loaded`   { nodes }
 *   host -> editor  `up-designer:connect`  { socketURL }
 *   editor -> host  `up-designer:save`     { seq, fig: ArrayBuffer, png: ArrayBuffer | null,
 *                                            width, height, nodes }
 *   host -> editor  `up-designer:saved`    { seq }
 *   host -> editor  `up-designer:save-now`                  (always saves)
 *   host -> editor  `up-designer:flush`                     (saves only unsaved changes)
 *   editor -> host  `up-designer:flushed`  { saved, unsaved } (saved: a save was confirmed;
 *                                                            unsaved: edits remain unsaved)
 *   editor -> host  `up-designer:error`    { reason, message }
 */
import { useIntervalFn } from '@vueuse/core'
import * as v from 'valibot'

import { SECOND_MS } from '@open-pencil/std/timing'

import { renderForModel } from '@/app/ai/tools/vision/render'
import { connectAutomation } from '@/app/automation/bridge/server'
import type { EditorStore } from '@/app/editor/active-store'
import { APP_VERSION } from '@/app/runtime/version'

import {
  postToUpDocsHost,
  postUpDocsError,
  setUpDocsSave,
  UP_DOCS_PROTOCOL_VERSION,
  upDocsHost
} from './channel'
import { hostMessageSchema, type UpDocsLoadMessage } from './schema'
import { refuseUpDocsCommand } from './tool-policy'

/** How often the editor checks for changes to save. */
const AUTOSAVE_CHECK_MS = 1.5 * SECOND_MS
/** How long a save waits for the host's `saved` before it counts as failed and stays unsaved. */
const SAVE_ACK_TIMEOUT_MS = 10 * SECOND_MS
/** How many saves a flush runs while edits keep arriving, before it reports what is unsaved. */
const FLUSH_ROUNDS = 3
/**
 * The longest side of the saved picture, in pixels: enough for a document preview, while a tall
 * page at full size would make a picture of over a megabyte. Smaller pages keep their size.
 */
export const UP_DOCS_PICTURE_MAX_EDGE = 2048

function countNodes(store: EditorStore): number {
  let total = 0
  for (const page of store.graph.getPages()) {
    const stack = [...store.graph.getChildren(page.id)]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) continue
      total += 1
      for (const child of store.graph.getChildren(node.id)) stack.push(child)
    }
  }
  return total
}

/** A PNG's own width and height, from its header, which may differ a little from the layout's. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return png.byteLength >= 24
    ? { width: view.getUint32(16), height: view.getUint32(20) }
    : { width: 0, height: 0 }
}

async function renderPicture(store: EditorStore, pageId: string) {
  const ids = store.graph.getChildren(pageId).map((node) => node.id)
  if (ids.length === 0) return null
  return renderForModel(store, ids, pageId, UP_DOCS_PICTURE_MAX_EDGE).catch((error: unknown) => {
    console.warn('[UP Docs] The picture could not be drawn', error)
    return null
  })
}

/** Starts talking to the UP Docs page; returns what stops it. Without a valid parent, does nothing. */
export function startUpDocsHost(getStore: () => EditorStore): () => void {
  const parentOrigin = upDocsHost?.parentOrigin
  if (!parentOrigin) {
    console.error('[UP Docs] No valid ?parent=<origin> in a frame: the editor talks to no host')
    return () => undefined
  }
  let disconnect: (() => void) | undefined
  /** Whether a document from the host is open, which saving waits for. */
  let loaded = false
  let loading = false
  let pendingLoad: Promise<void> | null = null
  /** Whether the host opened a design here once; a failed reopen keeps it, so it counts too. */
  let opened = false
  const autosave = useIntervalFn(() => void requestSave(false), AUTOSAVE_CHECK_MS, {
    immediate: false
  })
  let seq = 0
  /** How many saves the host has confirmed, which a flush compares. */
  let confirmed = 0
  /**
   * Saves run one at a time, each until the host confirms it, so two never race and a flush can
   * wait for the last. A request while one runs is kept and runs after it.
   */
  let running: Promise<void> | null = null
  let forceNext = false
  const acks = new Map<number, () => void>()

  /** Each connection's wait for its accepted calls, older ones included: their calls still run. */
  const bridgeIdle: (() => Promise<void>)[] = []

  function connect(socketURL: string) {
    disconnect?.()
    // No agent call edits a design before the host's has opened, or while another opens: the
    // swap would lose it, or the opening mark it saved.
    const refuse = (command: string, args: unknown) =>
      loading || !loaded
        ? 'A design is opening; try again in a moment'
        : refuseUpDocsCommand(command, args)
    const bridge = connectAutomation(getStore, null, socketURL, refuse)
    disconnect = bridge.disconnect
    bridgeIdle.push(bridge.whenIdle)
  }

  /** Waits for every agent call accepted so far, so none edits a design being replaced. */
  async function agentCallsSettled(): Promise<void> {
    await Promise.all(bridgeIdle.map((whenIdle) => whenIdle()))
  }

  function waitForAck(mySeq: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => settle(false), SAVE_ACK_TIMEOUT_MS)
      function settle(confirmed: boolean) {
        clearTimeout(timeout)
        acks.delete(mySeq)
        resolve(confirmed)
      }
      acks.set(mySeq, () => settle(true))
    })
  }

  /**
   * Writes the document and posts it, until the host confirms it. The document's own revision
   * tracking marks saved only the revision the file was written from, so an edit made meanwhile
   * stays unsaved; a save the host never confirms leaves the document unsaved too.
   */
  async function writeSave(): Promise<void> {
    const store = getStore()
    try {
      await store.saveFigFileCopy(async (fig) => {
        const mySeq = ++seq
        const picture = await renderPicture(store, store.state.currentPageId)
        const figBuffer = fig.slice().buffer
        const pngBuffer = picture ? picture.png.slice().buffer : null
        const size = picture ? pngSize(picture.png) : { width: 0, height: 0 }
        postToUpDocsHost(
          {
            type: 'up-designer:save',
            seq: mySeq,
            fig: figBuffer,
            png: pngBuffer,
            ...size,
            nodes: countNodes(store)
          },
          pngBuffer ? [figBuffer, pngBuffer] : [figBuffer]
        )
        if (!(await waitForAck(mySeq))) throw new Error(`UP Docs did not confirm save ${mySeq}`)
        confirmed += 1
      })
    } catch (error) {
      console.error('[UP Docs] Save failed', error)
      postUpDocsError('save-failed', error)
    }
  }

  /** Saves when asked (`force`) or when something is unsaved, after any save under way. */
  function requestSave(force: boolean): Promise<void> {
    if (!loaded) return Promise.resolve()
    if (running) {
      forceNext ||= force
      return running
    }
    if (!force && !getStore().hasUnsavedChanges()) return Promise.resolve()
    running = (async () => {
      try {
        await writeSave()
      } finally {
        running = null
      }
      const again = forceNext
      forceNext = false
      if (again) await requestSave(true)
    })()
    return running
  }

  /**
   * Saves only what is unsaved, as a page about to close asks: after the save under way, if any,
   * is confirmed. `saved` says whether a save was confirmed meanwhile and nothing is left unsaved.
   */
  async function flush(): Promise<void> {
    const confirmedBefore = confirmed
    if (pendingLoad) await pendingLoad
    if (running) await running
    // An edit made while a save waited for its confirmation is saved too, a few times at most.
    for (let round = 0; round < FLUSH_ROUNDS; round++) {
      if (!loaded || !getStore().hasUnsavedChanges()) break
      const confirmedNow = confirmed
      await requestSave(true)
      if (confirmed === confirmedNow) break
    }
    postToUpDocsHost({
      type: 'up-designer:flushed',
      saved: confirmed > confirmedBefore,
      // Edits in any design the host opened here count, whether or not it is still loaded.
      unsaved: opened && getStore().hasUnsavedChanges()
    })
  }

  /** Loads one at a time; a flush waits for the one under way. */
  function load(message: UpDocsLoadMessage): Promise<void> {
    if (loading) return Promise.resolve()
    pendingLoad = openDesign(message).finally(() => {
      pendingLoad = null
    })
    return pendingLoad
  }

  async function openDesign(message: UpDocsLoadMessage) {
    // One frame holds one design; a new one opens in a new frame, not over this one.
    if (opened && !message.bytes?.byteLength) {
      postUpDocsError('load-failed', new Error('A blank design opens in a new frame'))
      return
    }
    loading = true
    opened = true
    // A design open here keeps its edits: they are saved before another replaces it, and it stays
    // open, autosaving, if the other cannot be opened.
    const previous = loaded
    await agentCallsSettled()
    if (previous && getStore().hasUnsavedChanges()) await requestSave(true)
    else if (running) await running
    // Never over edits the host has not confirmed: it saves them first, or loads later.
    if (previous && getStore().hasUnsavedChanges()) {
      loading = false
      postUpDocsError('load-failed', new Error('The open design has edits UP Docs has not saved'))
      return
    }
    loaded = false
    autosave.pause()
    try {
      const name = message.name ?? 'Design'
      if (message.bytes && message.bytes.byteLength > 0) {
        // Opening marks the design saved as it was read, so nothing after it clears an edit.
        const opened = await getStore().openFigFile(new File([message.bytes], `${name}.fig`))
        if (!opened) throw new Error(`The design "${name}" could not be opened`)
        getStore().state.documentName = name
      } else {
        getStore().state.documentName = name
        getStore().markDocumentSaved()
      }
      postToUpDocsHost({ type: 'up-designer:loaded', nodes: countNodes(getStore()) })
      if (message.socketURL) connect(message.socketURL)
      loaded = true
      autosave.resume()
    } catch (error) {
      console.error('[UP Docs] Load failed', error)
      postUpDocsError('load-failed', error)
      loaded = previous
      if (previous) autosave.resume()
    } finally {
      loading = false
    }
  }

  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== parentOrigin) return
    const parsed = v.safeParse(hostMessageSchema, event.data)
    if (!parsed.success) {
      const type = v.safeParse(v.object({ type: v.string() }), event.data)
      // Messages for other listeners carry no `up-designer:` type; only malformed ones are reported.
      if (type.success && type.output.type.startsWith('up-designer:')) {
        postUpDocsError('invalid-message', new Error(v.summarize(parsed.issues)))
      }
      return
    }
    const message = parsed.output
    if (message.type === 'up-designer:load') void load(message)
    else if (message.type === 'up-designer:connect') connect(message.socketURL)
    else if (message.type === 'up-designer:saved') acks.get(message.seq)?.()
    else if (message.type === 'up-designer:flush') void flush()
    else void requestSave(true)
  }

  window.addEventListener('message', onMessage)
  setUpDocsSave(() => void requestSave(true))
  postToUpDocsHost({
    type: 'up-designer:ready',
    protocol: UP_DOCS_PROTOCOL_VERSION,
    version: APP_VERSION
  })
  return () => {
    window.removeEventListener('message', onMessage)
    setUpDocsSave(undefined)
    loaded = false
    autosave.pause()
    disconnect?.()
  }
}
