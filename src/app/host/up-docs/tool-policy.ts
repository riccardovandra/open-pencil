import {
  ALL_TOOLS,
  isToolExposed,
  type ToolCapability,
  type ToolDef
} from '@open-pencil/core/tools'
import { isRecord } from '@open-pencil/std/records'

/**
 * What an UP Docs agent may not do through the editor: run code, reach the network, the file
 * system, or the app's settings. The release's tool list (`tools/up-docs/tool-list.ts`) and the
 * editor's own refusal (`./bridge.ts`) both follow it; UP Docs enforces its copy as well.
 */
export const UP_DOCS_BLOCKED_CAPABILITIES: readonly ToolCapability[] = [
  'code:execute',
  'network:access',
  'filesystem:read',
  'filesystem:write',
  'settings:read',
  'settings:write'
]

/**
 * Allowed tools that compile the agent's design JSX into a function and run it in the editor
 * (`buildComponent` in `@open-pencil/design-jsx`). They need `'unsafe-eval'` in the editor's
 * content security policy, which only the editor's own, isolated origin may grant; UP Docs hides
 * them where it cannot (`evaluatesCode` in the tool list).
 */
const CODE_EVALUATING_TOOLS: ReadonlySet<string> = new Set([
  'render',
  'replace_node',
  'apply_patch'
])

export function upDocsToolEvaluatesCode(tool: Pick<ToolDef, 'name'>): boolean {
  return CODE_EVALUATING_TOOLS.has(tool.name)
}

/** Why `tool` is hidden from UP Docs agents; empty when it is allowed. */
export function upDocsToolBlockedBy(tool: ToolDef): string[] {
  return [
    ...tool.capabilities.filter((capability) => UP_DOCS_BLOCKED_CAPABILITIES.includes(capability)),
    ...(tool.availability === 'eval' ? ['availability:eval'] : [])
  ]
}

/** The tools MCP clients see, split into those UP Docs agents may call and those hidden. */
export function upDocsTools(): { mcp: ToolDef[]; allowed: ToolDef[]; hidden: ToolDef[] } {
  const mcp = ALL_TOOLS.filter((tool) => isToolExposed(tool, 'mcp'))
  return {
    mcp,
    allowed: mcp.filter((tool) => upDocsToolBlockedBy(tool).length === 0),
    hidden: mcp.filter((tool) => upDocsToolBlockedBy(tool).length > 0)
  }
}

/**
 * Bridge commands that open, save, or close files, read or change settings, or run code: an UP
 * Docs page owns its one document, so none of them has a use there.
 */
const REFUSED_COMMANDS = new Set([
  'eval',
  'open_document',
  'create_document',
  'save_document',
  'close_document',
  'activate_document',
  'list_recent_documents',
  'get_settings',
  'update_settings'
])

let allowedToolNames: ReadonlySet<string> | undefined

/** Why the editor refuses a bridge call in UP Docs, or null when it runs. */
export function refuseUpDocsCommand(command: string, args: unknown): string | null {
  if (REFUSED_COMMANDS.has(command)) return `"${command}" is not available in UP Docs`
  if (command !== 'tool') return null
  allowedToolNames ??= new Set(upDocsTools().allowed.map((tool) => tool.name))
  const name = isRecord(args) ? args.name : undefined
  if (typeof name === 'string' && allowedToolNames.has(name)) return null
  return `The tool "${String(name)}" is not available in UP Docs`
}
