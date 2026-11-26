#!/bin/sh
# UP Docs P0: the editor as UP Docs serves it, under /designer/, Cloud off, no telemetry
# (VITE_OPENPENCIL_FEEDBACK unset), no service worker in host mode. Output: dist/.
set -eu
cd "$(dirname "$0")/../.."
export VITE_OPENPENCIL_CLOUD=off
unset VITE_OPENPENCIL_FEEDBACK || true
# Without the wasm32 Rust target the HTML engine (HTML import) is left out; set to 0 to build it.
export OPENPENCIL_SKIP_HTML_ENGINE_WASM="${OPENPENCIL_SKIP_HTML_ENGINE_WASM:-1}"
bun run build:packages
bunx vite build --base /designer/
node tools/up-docs/tool-list.ts dist/up-docs-tools.json
