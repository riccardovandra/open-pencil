/**
 * What the editor leaves out inside an UP Docs page: the page opens, saves, and closes its one
 * document, so the menu items and keys that open, save elsewhere, or close files, switch tabs, or
 * start the tour are gone. Export stays: it hands a copy to the person, not the document.
 */
const HIDDEN_MENU_ITEMS: ReadonlySet<string> = new Set([
  'new',
  'new-board',
  'new-tab',
  'open',
  'open-url',
  'open-recent',
  'save-as',
  'save-to',
  'save-version',
  'version-history',
  'autosave',
  'close',
  'previous-tab',
  'next-tab',
  'open-tour',
  'check-updates',
  'quit'
])

/** The app keys of those items, by their id in `src/app/shell/keyboard/registry.ts`. */
const REFUSED_SHORTCUTS: ReadonlySet<string> = new Set([
  'new-design',
  'new-tab',
  'open-file',
  'save-as',
  'save-version',
  'close-tab',
  'previous-tab',
  'next-tab'
])

export function hidesUpDocsMenuItem(id: string): boolean {
  return HIDDEN_MENU_ITEMS.has(id)
}

export function refusesUpDocsShortcut(id: string): boolean {
  return REFUSED_SHORTCUTS.has(id)
}
