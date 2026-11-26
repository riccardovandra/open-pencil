/**
 * UP Docs host bridge (prototype P0).
 *
 * When the editor runs inside an UP Docs page (`?host=up-docs`), the page around it owns the
 * document: it sends the `.fig` bytes and the automation socket URL, and receives every save
 * (`.fig` bytes plus a PNG picture of the current page). Messages go to and from `window.parent`
 * only. Protocol, all `{ type, ... }` objects:
 *   editor -> host  `up-designer:ready`
 *   host -> editor  `up-designer:load`   { bytes: ArrayBuffer | null, name: string, socketURL?: string }
 *   editor -> host  `up-designer:loaded` { nodes: number }
 *   editor -> host  `up-designer:save`   { seq, fig: ArrayBuffer, png: ArrayBuffer | null, nodes }
 *   host -> editor  `up-designer:saved`  { seq }
 *   host -> editor  `up-designer:save-now`
 */
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { SECOND_MS } from '@open-pencil/std/timing'

import { connectAutomation } from '@/app/automation/bridge/server'
import type { EditorStore } from '@/app/editor/active-store'

/** How often the bridge checks for unsaved changes to send. */
const AUTOSAVE_CHECK_MS = 1.5 * SECOND_MS

type LoadMessage = { type: 'up-designer:load'; bytes: ArrayBuffer | null; name?: string; socketURL?: string }

export function isUpDocsHost(): boolean {
  return new URLSearchParams(window.location.search).get('host') === 'up-docs'
}

function post(message: Record<string, unknown>, transfer: Transferable[] = []) {
  window.parent.postMessage(message, '*', transfer)
}

function countNodes(store: EditorStore): number {
  let total = 0
  for (const page of store.graph.getPages()) {
    const stack = [...store.graph.getChildren(page.id)]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) continue
      total += 1
      stack.push(...store.graph.getChildren(node.id))
    }
  }
  return total
}

export function startUpDocsHost(getStore: () => EditorStore): () => void {
  let disconnect: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let seq = 0
  let saving = false
  const pending = new Map<number, () => void>()

  async function save(force = false) {
    const store = getStore()
    if (saving || (!force && !store.hasUnsavedChanges())) return
    saving = true
    try {
      const mySeq = ++seq
      const pageId = store.state.currentPageId
      const fig = await exportFigFile(store.graph, {
        pageId,
        documentName: store.state.documentName
      })
      const png = await store.renderExportImage([], 1, 'PNG', pageId).catch(() => null)
      // Marked saved before the host acks: an edit made while this save travels counts again.
      store.markDocumentSaved()
      const figBuffer = fig.slice().buffer
      const pngBuffer = png ? png.slice().buffer : null
      post(
        { type: 'up-designer:save', seq: mySeq, fig: figBuffer, png: pngBuffer, nodes: countNodes(store) },
        pngBuffer ? [figBuffer, pngBuffer] : [figBuffer]
      )
      await new Promise<void>((resolve) => {
        pending.set(mySeq, resolve)
        setTimeout(resolve, 10 * SECOND_MS)
      })
    } catch (error) {
      console.error('[UP Docs] save failed', error)
    } finally {
      saving = false
    }
  }

  async function load(message: LoadMessage) {
    const store = getStore()
    if (message.bytes && message.bytes.byteLength > 0) {
      const name = message.name ?? 'Design'
      await store.openFigFile(new File([message.bytes], `${name}.fig`))
    } else if (message.name) {
      store.state.documentName = message.name
    }
    store.markDocumentSaved()
    post({ type: 'up-designer:loaded', nodes: countNodes(store) })
    if (message.socketURL) disconnect = connectAutomation(getStore, null, message.socketURL).disconnect
    timer = setInterval(() => void save(), AUTOSAVE_CHECK_MS)
  }

  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent) return
    const data = event.data as { type?: unknown; seq?: unknown } | null
    if (!data || typeof data.type !== 'string') return
    if (data.type === 'up-designer:load') void load(data as LoadMessage)
    else if (data.type === 'up-designer:saved' && typeof data.seq === 'number') {
      pending.get(data.seq)?.()
      pending.delete(data.seq)
    } else if (data.type === 'up-designer:save-now') void save(true)
  }

  window.addEventListener('message', onMessage)
  post({ type: 'up-designer:ready' })
  return () => {
    window.removeEventListener('message', onMessage)
    clearInterval(timer)
    disconnect?.()
  }
}
