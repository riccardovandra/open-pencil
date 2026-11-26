import { describe, expect, test } from 'bun:test'

import {
  refuseUpDocsCommand,
  upDocsToolEvaluatesCode,
  upDocsTools
} from '@/app/host/up-docs/tool-policy'

describe('UP Docs tool policy', () => {
  test('hides eval and every tool that reaches the network, files, or settings', () => {
    const { allowed, hidden } = upDocsTools()
    const hiddenNames = hidden.map((tool) => tool.name)
    expect(hiddenNames).toContain('eval')
    expect(hiddenNames).toContain('search_web')
    for (const tool of allowed) {
      expect(tool.availability).toBe('default')
      expect(tool.capabilities).not.toContain('network:access')
      expect(tool.capabilities).not.toContain('code:execute')
      expect(tool.capabilities).not.toContain('filesystem:read')
      expect(tool.capabilities).not.toContain('filesystem:write')
      expect(tool.capabilities).not.toContain('settings:read')
      expect(tool.capabilities).not.toContain('settings:write')
    }
    expect(allowed.length).toBeGreaterThan(0)
  })

  test('refuses bridge calls that run code, open files, or use a hidden tool', () => {
    const allowedTool = upDocsTools().allowed[0]?.name
    expect(refuseUpDocsCommand('eval', { code: '1' })).not.toBeNull()
    expect(refuseUpDocsCommand('open_document', { path: '/tmp/x.fig' })).not.toBeNull()
    expect(refuseUpDocsCommand('update_settings', {})).not.toBeNull()
    expect(refuseUpDocsCommand('tool', { name: 'eval', args: {} })).not.toBeNull()
    expect(refuseUpDocsCommand('tool', { name: 'search_web', args: {} })).not.toBeNull()
    expect(refuseUpDocsCommand('tool', {})).not.toBeNull()
    expect(refuseUpDocsCommand('tool', { name: allowedTool, args: {} })).toBeNull()
    expect(refuseUpDocsCommand('undo', {})).toBeNull()
    expect(refuseUpDocsCommand('tree', {})).toBeNull()
  })

  test("flags the allowed tools that run the agent's JSX as code", () => {
    const flagged = upDocsTools()
      .allowed.filter((tool) => upDocsToolEvaluatesCode(tool))
      .map((tool) => tool.name)
    expect(flagged.toSorted()).toEqual(['apply_patch', 'render', 'replace_node'])
  })
})
