/**
 * The editor's side of the UP Docs host channel: whether the editor runs inside an UP Docs page,
 * which origin that page has, and posting to it. Read once, when the app starts, from
 * `?host=up-docs&parent=<origin>`, before anything rewrites the address. It imports nothing of the
 * app, so the support gate in `src/main.ts` can report a failed start without loading it.
 */
import { IS_BROWSER } from '@open-pencil/core/constants'
import { errorMessage } from '@open-pencil/std/errors'

/** The protocol version the editor speaks, sent with `up-designer:ready`. */
export const UP_DOCS_PROTOCOL_VERSION = 1

export type UpDocsHost = {
  /**
   * The UP Docs page's origin, the only one the editor takes messages from and posts to. Null
   * when `parent` is missing or invalid, or the editor is not in a frame: the editor then runs
   * with host mode's interface but talks to no one.
   */
  parentOrigin: string | null
}

/**
 * The origin `value` names, exactly as written: `http:` or `https:`, with no path, query, or
 * trailing slash. `*` and opaque origins are refused, since a message posted to them could reach
 * any page.
 */
export function parseParentOrigin(value: string | null): string | null {
  if (!value || value === '*' || value === 'null') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.origin === value ? value : null
}

export function parseUpDocsHost(search: string, framed: boolean): UpDocsHost | null {
  const params = new URLSearchParams(search)
  if (params.get('host') !== 'up-docs') return null
  return { parentOrigin: framed ? parseParentOrigin(params.get('parent')) : null }
}

/** The UP Docs page around the editor, or null when the editor runs on its own. */
export const upDocsHost: UpDocsHost | null = IS_BROWSER
  ? parseUpDocsHost(window.location.search, window.parent !== window)
  : null

export function isUpDocsHost(): boolean {
  return upDocsHost !== null
}

export type UpDocsErrorReason =
  | 'unsupported-browser'
  | 'boot-failed'
  | 'invalid-message'
  | 'load-failed'
  | 'save-failed'

/** Posts `message` to the UP Docs page, and only to its origin; without one, posts nothing. */
export function postToUpDocsHost(
  message: { type: `up-designer:${string}` } & Record<string, unknown>,
  transfer: Transferable[] = []
): boolean {
  const origin = upDocsHost?.parentOrigin
  if (!origin) return false
  window.parent.postMessage(message, origin, transfer)
  return true
}

/** Tells the UP Docs page what went wrong, so it can say so instead of showing a blank frame. */
export function postUpDocsError(reason: UpDocsErrorReason, error: unknown): boolean {
  return postToUpDocsHost({ type: 'up-designer:error', reason, message: errorMessage(error) })
}

/** The running bridge's save (`./bridge.ts`), kept here so Save reaches it without importing it. */
let hostSave: (() => void) | undefined

export function setUpDocsSave(save: (() => void) | undefined): void {
  hostSave = save
}

/** Saves to the UP Docs page now, as its `save-now` does; Save in the menu or with its key. */
export function requestUpDocsSave(): void {
  hostSave?.()
}
