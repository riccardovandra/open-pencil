// The tools an UP Docs agent may call, with their JSON Schemas, as the editor's own policy decides
// (`src/app/host/up-docs/tool-policy.ts`). Writes JSON to the path given, or to stdout:
//   bun tools/up-docs/tool-list.ts dist/up-docs-tools.json
import { writeFile } from 'node:fs/promises'

import { toolInputFor, toolJSONSchema, toolNumberSchema } from '@open-pencil/core/tools'

import {
  UP_DOCS_BLOCKED_CAPABILITIES,
  upDocsToolBlockedBy,
  upDocsToolEvaluatesCode,
  upDocsTools
} from '@/app/host/up-docs/tool-policy'

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

const { mcp, allowed, hidden } = upDocsTools()

const out = {
  generatedFrom: 'packages/core/src/tools/registry (ALL_TOOLS, MCP exposure)',
  blockedCapabilities: UP_DOCS_BLOCKED_CAPABILITIES,
  counts: { mcp: mcp.length, allowed: allowed.length, hidden: hidden.length },
  hidden: hidden.map((tool) => ({ name: tool.name, blockedBy: upDocsToolBlockedBy(tool) })),
  tools: allowed.map((tool) => ({
    name: tool.name,
    description: tool.description,
    mutates: tool.mutates,
    capabilities: tool.capabilities,
    // Runs the agent's JSX as code in the editor: only where the editor has its own origin.
    evaluatesCode: upDocsToolEvaluatesCode(tool),
    inputSchema: toolJSONSchema(toolInputFor(tool, 'mcp'), config)
  }))
}

const json = `${JSON.stringify(out, null, 2)}\n`
const target = process.argv[2]
if (target) await writeFile(target, json)
else process.stdout.write(json)
process.stderr.write(`tools: ${allowed.length} allowed, ${hidden.length} hidden of ${mcp.length}\n`)
