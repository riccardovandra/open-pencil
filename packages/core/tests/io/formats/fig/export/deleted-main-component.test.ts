import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { open } from '#core-tests/helpers/fig/archive'
import { runTool } from '#core-tests/helpers/tools'

import { createEditor, type Editor } from '@open-pencil/core'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  exportFigFile,
  populateAllFigPages,
  populateFigPage
} from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createInstance, lostMainComponent } from '@open-pencil/scene-graph/instances'
import { expectDefined } from '@open-pencil/test-support/assert'
import { repoPath } from '@open-pencil/test-support/paths'

setDefaultTimeout(120_000)

const demoBytes = () => new Uint8Array(readFileSync(repoPath('public/demo.fig')))

/**
 * Every layer of a page as the editor shows it, one line each. An instance whose main component
 * is gone reads back as the frame the export keeps it as.
 */
function layerLines(graph: SceneGraph, pageId: string): string[] {
  const lines: string[] = []
  const visit = (id: string, depth: number) => {
    for (const child of graph.getChildren(id)) {
      const type = lostMainComponent(graph, child) ? 'FRAME' : child.type
      const box = [child.x, child.y, child.width, child.height].map(Math.round).join(',')
      lines.push(`${'  '.repeat(depth)}${child.name} ${type} ${box} ${child.text}`)
      visit(child.id, depth + 1)
    }
  }
  visit(pageId, 0)
  return lines
}

const firstPage = (graph: SceneGraph) => graph.getPages()[0]

function childNamed(graph: SceneGraph, parentId: string, name: string): SceneNode {
  return expectDefined(
    graph.getChildren(parentId).find((child) => child.name === name),
    name
  )
}

function deleteSections(editor: Editor, graph: SceneGraph, names: string[]) {
  for (const name of names) {
    editor.select([childNamed(graph, firstPage(graph).id, name).id])
    editor.deleteSelected()
  }
}

async function reopened(graph: SceneGraph) {
  return open(await exportFigFile(graph))
}

describe('saving after a main component is deleted', () => {
  test.each([[['8 · Yours']], [['8 · Yours', '7 · Lint']]])(
    'keeps every layer of its instances when %p is deleted in the editor',
    async (sections) => {
      const graph = await open(demoBytes())
      deleteSections(createEditor({ graph }), graph, sections)
      expect([...graph.instanceIndex.keys()].some((id) => !graph.getNode(id))).toBe(true)
      const saved = await reopened(graph)
      expect(layerLines(saved, firstPage(saved).id)).toEqual(layerLines(graph, firstPage(graph).id))
      // A file saved this way saves again unchanged.
      const again = await reopened(saved)
      expect(layerLines(again, firstPage(again).id)).toEqual(layerLines(saved, firstPage(saved).id))
    }
  )

  test('keeps them on a page that was never opened', async () => {
    // A file with an instance of Tip on a second page, which opens unloaded.
    const setup = await open(demoBytes())
    const tip = expectDefined(
      [...setup.getAllNodes()].find((node) => node.type === 'COMPONENT' && node.name === 'Tip'),
      'Tip'
    )
    const other = setup.addPage('Other')
    expectDefined(createInstance(setup, tip.id, other.id, { name: 'Far tip' }), 'instance')
    const twoPages = await exportFigFile(setup)

    const graph = await open(twoPages)
    const page = graph.getPages()[1]
    deleteSections(createEditor({ graph }), graph, ['8 · Yours'])
    const saved = await reopened(graph)
    // The page loads after the delete, its instance holding what it showed.
    populateFigPage(graph, page.id)
    const expected = layerLines(graph, page.id)
    expect(expected).toEqual(
      layerLines(setup, other.id).map((line, index) =>
        index === 0 ? line.replace('INSTANCE', 'FRAME') : line
      )
    )
    populateAllFigPages(saved)
    expect(layerLines(saved, saved.getPages()[1].id)).toEqual(expected)
  })

  test('keeps them when an agent deletes the component through the tools', async () => {
    const graph = await open(demoBytes())
    const section = childNamed(graph, firstPage(graph).id, '8 · Yours')
    expect(await runTool(new FigmaAPI(graph), 'delete_nodes', { ids: [section.id] })).toEqual({
      deleted: [section.id]
    })
    const saved = await reopened(graph)
    expect(layerLines(saved, firstPage(saved).id)).toEqual(layerLines(graph, firstPage(graph).id))
  })

  test('writes the instances as frames holding their layers in a document with no archive', async () => {
    await initCodec()
    const graph = new SceneGraph()
    const page = firstPage(graph)
    const inner = graph.createNode('COMPONENT', page.id, { name: 'Inner', width: 40, height: 20 })
    graph.createNode('TEXT', inner.id, { name: 'Label', text: 'inner' })
    const outer = graph.createNode('COMPONENT', page.id, { name: 'Outer', width: 80, height: 40 })
    graph.createNode('RECTANGLE', outer.id, { name: 'Box', width: 80, height: 40 })
    expectDefined(createInstance(graph, inner.id, outer.id, { name: 'Nested' }), 'nested')
    const other = graph.addPage('Other')
    const instance = expectDefined(
      createInstance(graph, outer.id, other.id, { name: 'Copy' }),
      'instance'
    )
    const label = childNamed(graph, childNamed(graph, instance.id, 'Nested').id, 'Label')
    graph.updateNode(label.id, { text: 'changed' })
    graph.deleteNode(outer.id)
    expect(lostMainComponent(graph, instance)).toBe(true)

    const saved = await reopened(graph)
    populateAllFigPages(saved)
    expect(layerLines(saved, saved.getPages()[1].id)).toEqual(layerLines(graph, other.id))
    const copy = childNamed(saved, saved.getPages()[1].id, 'Copy')
    expect(copy.type).toBe('FRAME')
    // The nested instance named its main through the deleted component, so it is kept as a
    // frame too, with what it showed.
    const nested = childNamed(saved, copy.id, 'Nested')
    expect(nested.type).toBe('FRAME')
    expect(saved.getChildren(nested.id).map((child) => child.text)).toEqual(['changed'])
  })
})

describe('other component edits save their instances whole', () => {
  test('swapping an instance to another component', async () => {
    const graph = await open(demoBytes())
    const tip = expectDefined(
      [...graph.getAllNodes()].find((node) => node.type === 'INSTANCE' && node.name === 'Tip 1'),
      'Tip 1'
    )
    const target = expectDefined(
      [...graph.getAllNodes()].find(
        (node) =>
          node.type === 'COMPONENT' &&
          node.name !== 'Tip' &&
          graph.getNode(node.parentId ?? '')?.type !== 'COMPONENT_SET'
      ),
      'another component'
    )
    graph.swapInstanceComponent(tip.id, target.id)
    const saved = await reopened(graph)
    expect(layerLines(saved, firstPage(saved).id)).toEqual(layerLines(graph, firstPage(graph).id))
  })

  test('detaching an instance', async () => {
    const graph = await open(demoBytes())
    const editor = createEditor({ graph })
    const tip = expectDefined(
      [...graph.getAllNodes()].find((node) => node.type === 'INSTANCE' && node.name === 'Tip 1'),
      'Tip 1'
    )
    editor.select([tip.id])
    editor.detachInstance()
    expect(graph.getNode(tip.id)?.type).toBe('FRAME')
    const saved = await reopened(graph)
    expect(layerLines(saved, firstPage(saved).id)).toEqual(layerLines(graph, firstPage(graph).id))
  })

  test('moving a main component to another page', async () => {
    const graph = await open(demoBytes())
    const editor = createEditor({ graph })
    const tip = expectDefined(
      [...graph.getAllNodes()].find((node) => node.type === 'COMPONENT' && node.name === 'Tip'),
      'Tip'
    )
    const page = graph.addPage('Parts')
    editor.select([tip.id])
    editor.moveToPage(page.id)
    expect(graph.getNode(tip.id)?.parentId).toBe(page.id)
    const saved = await reopened(graph)
    expect(layerLines(saved, firstPage(saved).id)).toEqual(layerLines(graph, firstPage(graph).id))
    const parts = childNamed(saved, saved.getPages()[1].id, 'Tip')
    expect(parts.type).toBe('COMPONENT')
  })
})
