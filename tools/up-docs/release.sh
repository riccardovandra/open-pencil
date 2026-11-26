#!/bin/sh
# Builds the editor as UP Docs embeds it and packs it for a release:
#   tools/up-docs/release.sh <version> [out-dir]     e.g. tools/up-docs/release.sh up-docs-v1
# Writes <out-dir>/designer-<version>.tar.gz, its files at the archive root, and
# designer-<version>.tar.gz.sha256 ("<hex>  <file name>"). <out-dir> defaults to release/.
#
# The build has a relative base, so the same files run at / on their own origin and under any
# path such as /designer/. Cloud is off and nothing is sent: VITE_OPENPENCIL_FEEDBACK stays unset.
# HTML import needs the wasm32 Rust target; set OPENPENCIL_SKIP_HTML_ENGINE_WASM=1 to build
# without it on a machine that lacks it (never for a release).
set -eu
version=${1:?usage: tools/up-docs/release.sh <version> [out-dir]}
cd "$(dirname "$0")/../.."
out=$(mkdir -p "${2:-release}" && cd "${2:-release}" && pwd)
archive="designer-$version.tar.gz"

export VITE_OPENPENCIL_CLOUD=off
unset VITE_OPENPENCIL_FEEDBACK || true

bun run build:packages
bunx vite build --base ./
bun tools/up-docs/tool-list.ts dist/up-docs-tools.json
commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
printf '{ "version": "%s", "commit": "%s", "protocol": 1 }\n' "$version" "$commit" \
  > dist/up-docs-release.json

# Files at the archive root, in a stable order, so it unpacks straight into the folder served.
(cd dist && find . -mindepth 1 -maxdepth 1 | sed 's|^\./||' | LC_ALL=C sort \
  | tar -czf "$out/$archive" -T -)
if command -v sha256sum > /dev/null; then
  (cd "$out" && sha256sum "$archive" > "$archive.sha256")
else
  (cd "$out" && shasum -a 256 "$archive" > "$archive.sha256")
fi
cat "$out/$archive.sha256"
