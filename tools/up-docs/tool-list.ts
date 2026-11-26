// UP Docs P0: the tools an UP Docs agent may call, with JSON Schemas, chosen by each tool's
// declared capabilities. Hidden: running code (`code:execute`, `eval` availability), the network,
// the file system and settings. Writes JSON to the path given, or stdout.
//   bun tools/up-docs/tool-list.ts dist/up-docs-tools.json
import { writeFile } from 'node:fs/promises'

import {
  ALL_TOOLS,
  isToolExposed,
  toolInputFor,
  toolJSONSchema,
  toolNumberSchema,
  type ToolCapability
} from '@open-pencil/core/tools'

// As packages/mcp/src/tool/schema.ts converts inputs: numeric-string unions as numbers, input mode.
type Config = NonNullable<Parameters<typeof toolJSONSchema>[1]>
const config: Config = {
  target: 'draft-07',
  typeMode: 'input',
  overrideSchema({ valibotSchema }) {
    const number = toolNumberSchema(valibotSchema)
    return number ? toolJSONSchema(number, config) : undefined
  }
}

const BLOCKED: readonly ToolCapability[] = [
  'code:execute',
  'network:access',
  'filesystem:read',
  'filesystem:write',
  'settings:read',
  'settings:write'
]

const mcpTools = ALL_TOOLS.filter((tool) => isToolExposed(tool, 'mcp'))
const blockedBy = (tool: (typeof ALL_TOOLS)[number]) => [
  ...tool.capabilities.filter((c) => BLOCKED.includes(c)),
  ...(tool.availability === 'eval' ? ['availability:eval'] : [])
]
const allowed = mcpTools.filter((tool) => blockedBy(tool).length === 0)
const hidden = mcpTools.filter((tool) => blockedBy(tool).length > 0)

const out = {
  generatedFrom: 'packages/core/src/tools/registry (ALL_TOOLS, MCP exposure)',
  blockedCapabilities: BLOCKED,
  counts: { all: ALL_TOOLS.length, mcp: mcpTools.length, allowed: allowed.length, hidden: hidden.length },
  hidden: hidden.map((tool) => ({ name: tool.name, blockedBy: blockedBy(tool) })),
  tools: allowed.map((tool) => ({
    name: tool.name,
    description: tool.description,
    mutates: tool.mutates,
    capabilities: tool.capabilities,
    inputSchema: toolJSONSchema(toolInputFor(tool, 'mcp'), config)
  }))
}

const json = JSON.stringify(out, null, 2)
const target = process.argv[2]
if (target) await writeFile(target, json)
else console.log(json)
console.error(`tools: ${allowed.length} allowed, ${hidden.length} hidden of ${mcpTools.length} MCP`)
