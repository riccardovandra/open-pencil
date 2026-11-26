// A stand-in UP Docs page for trying a build of the embedded editor (`dist/`), with no UP Docs.
//   bun tools/up-docs/harness.ts            then open http://localhost:4611/
// Three origins:
//   http://localhost:4610  the editor on its own origin, at / and under /designer/
//   http://localhost:4611  the host page; it also serves the editor under /designer/ (same origin)
//   http://localhost:4612  the same host page on an origin the editor was not told about
// Host page options: ?editor=<editor base URL> (default http://localhost:4610/),
// ?parent=<origin to claim> (default the page's own), ?fixture=<public file> (default demo.fig).
// The page logs every message and exposes window.harness (log, saves, ackSaves, flush(),
// saveNow(), reloadLastSave()).
import { existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const DIST = join(ROOT, 'dist')
const PUBLIC = join(ROOT, 'public')
const EDITOR_PORT = 4610
const HOST_PORT = 4611
const OTHER_HOST_PORT = 4612

function fileResponse(path: string): Response {
  return new Response(Bun.file(path))
}

/** A file of the build under `prefix`, or its index.html for an app address. */
function serveEditor(pathname: string, prefix: string): Response | null {
  if (!pathname.startsWith(prefix)) return null
  const relative = normalize(decodeURIComponent(pathname.slice(prefix.length)))
  if (relative.startsWith('..')) return new Response('Not found', { status: 404 })
  const path = join(DIST, relative)
  if (relative !== '.' && existsSync(path) && statSync(path).isFile()) return fileResponse(path)
  return fileResponse(join(DIST, 'index.html'))
}

const HOST_PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><title>UP Docs host harness</title>
<style>
  body { margin: 0; font: 13px system-ui; display: grid; grid-template-columns: 1fr 320px; height: 100vh; }
  iframe { width: 100%; height: 100%; border: 0; }
  aside { overflow: auto; padding: 8px; border-inline-start: 1px solid #ccc; }
  pre { white-space: pre-wrap; word-break: break-all; }
  img { max-width: 100%; border: 1px solid #ccc; }
</style></head>
<body>
<iframe id="editor"></iframe>
<aside>
  <button onclick="harness.saveNow()">save-now</button>
  <button onclick="harness.flush()">flush</button>
  <p id="picture"></p>
  <pre id="log"></pre>
</aside>
<script type="module">
const params = new URLSearchParams(location.search)
const editorBase = new URL(params.get('editor') ?? 'http://localhost:${EDITOR_PORT}/', location.href)
const parent = params.get('parent') ?? location.origin
const fixture = params.get('fixture') ?? 'demo.fig'
const frame = document.getElementById('editor')
const editorURL = new URL(editorBase)
editorURL.searchParams.set('host', 'up-docs')
editorURL.searchParams.set('parent', parent)
frame.src = editorURL.href
const log = []
const saves = []
const out = document.getElementById('log')
function record(entry) {
  log.push(entry)
  out.textContent = log.map((e) => JSON.stringify(e)).join('\\n')
}
function send(message, transfer = []) {
  record({ to: message.type })
  frame.contentWindow.postMessage(message, editorBase.origin, transfer)
}
window.addEventListener('message', async (event) => {
  if (event.source !== frame.contentWindow) return
  const data = event.data ?? {}
  if (event.origin !== editorBase.origin) return record({ refused: event.origin, type: data.type })
  const { fig, png, ...rest } = data
  record({ from: data.type, ...rest, figBytes: fig?.byteLength, pngBytes: png?.byteLength })
  if (data.type === 'up-designer:ready') {
    const bytes = await (await fetch('/fixture/' + fixture)).arrayBuffer()
    send({ type: 'up-designer:load', bytes, name: 'Harness design' }, [bytes])
  } else if (data.type === 'up-designer:save') {
    saves.push({ seq: data.seq, fig, png, width: data.width, height: data.height, nodes: data.nodes })
    if (png) {
      const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      document.getElementById('picture').innerHTML =
        '<img src="' + url + '"><br>' + data.width + ' x ' + data.height
    }
    if (window.harness.ackSaves) send({ type: 'up-designer:saved', seq: data.seq })
  }
})
window.harness = {
  /** Set false to leave saves unconfirmed, as a host that failed to store them would. */
  ackSaves: true,
  log,
  saves,
  editorURL: editorURL.href,
  saveNow: () => send({ type: 'up-designer:save-now' }),
  flush: () => send({ type: 'up-designer:flush' }),
  /** Loads the last save back into the editor: a round trip through the host. */
  reloadLastSave: () => {
    const last = saves.at(-1)
    if (!last) return false
    const bytes = last.fig.slice(0)
    send({ type: 'up-designer:load', bytes, name: 'Harness design (reloaded)' }, [bytes])
    return true
  }
}
</script>
</body></html>`

function serveHost(request: Request): Response {
  const { pathname } = new URL(request.url)
  if (pathname === '/') return new Response(HOST_PAGE, { headers: { 'content-type': 'text/html' } })
  if (pathname.startsWith('/fixture/')) {
    const name = normalize(pathname.slice('/fixture/'.length))
    if (name.startsWith('..')) return new Response('Not found', { status: 404 })
    return fileResponse(join(PUBLIC, name))
  }
  return serveEditor(pathname, '/designer/') ?? new Response('Not found', { status: 404 })
}

if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error(
    'No dist/index.html: build first (vite build --base ./, see tools/up-docs/release.sh)'
  )
}

const log = (port: number, request: Request) =>
  console.log(`${port} ${request.method} ${new URL(request.url).pathname}`)

Bun.serve({
  port: EDITOR_PORT,
  fetch(request) {
    log(EDITOR_PORT, request)
    const { pathname } = new URL(request.url)
    return serveEditor(pathname, '/designer/') ?? serveEditor(pathname, '/') ?? new Response('')
  }
})
for (const port of [HOST_PORT, OTHER_HOST_PORT]) {
  Bun.serve({
    port,
    fetch(request) {
      log(port, request)
      return serveHost(request)
    }
  })
}
console.log(`Host page: http://localhost:${HOST_PORT}/`)
