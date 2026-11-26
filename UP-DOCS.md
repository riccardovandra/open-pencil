# OpenPencil for UP Docs

This fork builds the OpenPencil editor that UP Docs embeds as its design tool. UP Docs
drives the editor from the user's agent thread, so the editor has no chat of its own.
Each UP Docs page holds one design, and that page loads and stores it. Upstream is
[open-pencil/open-pencil](https://github.com/open-pencil/open-pencil), MIT licensed. Every
license notice stays as upstream has it.

## Branches

- `up-docs-main`: upstream `master` plus the patch set below. Pull requests go here.
- `master`: a copy of upstream. Do not push it to this fork. It still contains upstream's
  workflows, which must not run here.
- Tags `up-docs-v<n>`: one release each.

## The patch set

Each commit covers one concern, so an upstream sync is a rebase.

1. `ci`: removes upstream's workflows and Dependabot. They need upstream's secrets and
   infrastructure.
2. `build`: `OPENPENCIL_SKIP_HTML_ENGINE_WASM=1` lets a machine without the `wasm32` Rust target
   build without HTML import. Releases never set it.
3. Removes the in-tool chat: the panels, the floating chat, the Toggle AI Chat item and its
   shortcut. `src/app/ai` stays, because the automation bridge runs its tools.
4. Serves the app under any path. A relative-base build (`--base ./`) finds its path at runtime,
   so the same files run at `/` and under `/designer/`.
5. Adds host mode (`?host=up-docs&parent=<origin>`, in `src/app/host/up-docs/`). It hides Home,
   the welcome screen, prompts, campaigns, the tab strip, Share and collaboration. It also turns
   off the service worker, online fonts, the local MCP probe, and the file menu items and keys
   that open, create, close or save documents elsewhere.
6. Adds the host bridge (`src/app/host/up-docs/bridge.ts`). The editor and the UP Docs page talk
   only through `postMessage`, and only with the parent origin. The protocol is described at the
   top of that file. The editor also refuses `eval`, file, settings and hidden-tool calls itself.
7. `build`: `tools/up-docs/release.sh` builds the archive and `tools/up-docs/tool-list.ts`
   writes `up-docs-tools.json`, the tools UP Docs agents may call.
8. `ci`: `.github/workflows/up-docs-release.yml` builds and tests pull requests and publishes
   tags.

Upstream's chat end-to-end specs (`tests/e2e/chat/**`) and the floating-chat case in
`tests/e2e/canvas/board/chrome.spec.ts` now fail. They are left unchanged so that rebases stay
clean. Nothing here runs them.

## Agent code in the editor

Three allowed tools, `render`, `replace_node` and `apply_patch`, compile the agent's design JSX
into a function and run it in the editor. They are marked `evaluatesCode: true` in
`up-docs-tools.json`. They need `'unsafe-eval'` in the editor's content security policy, so UP
Docs grants that only on the editor's own origin. The app origin is never relaxed. The editor's
origin holds no UP Docs session, and its CSP keeps `connect-src 'self'` and `img-src 'self' blob: data:`.
So code running there can reach only the editor's own files and storage, plus the parent page
through origin-checked `postMessage`. In the same-origin `/designer/` fallback, UP Docs hides
these three tools. `eval` stays hidden everywhere, and the editor refuses it even if asked.

## Sync with upstream

```sh
git remote add upstream https://github.com/open-pencil/open-pencil.git   # once
git fetch upstream
git switch up-docs-main
git rebase upstream/master          # resolve conflicts one patch at a time
bun install --frozen-lockfile
OPENPENCIL_SKIP_HTML_ENGINE_WASM=1 tools/up-docs/release.sh up-docs-local   # local smoke build
git push --force-with-lease origin up-docs-main
```

During the rebase:

- If upstream adds or changes a workflow, delete it again (`git rm .github/workflows/<file>`).
  Keep only `up-docs-release.yml`.
- If upstream adds a menu item, key or screen that opens files, rooms or services, add it to
  `src/app/host/up-docs/interface.ts` or guard it with `isUpDocsHost()`.
- If upstream changes tools, check `up-docs-tools.json` in the next build. The hidden list must
  still contain `eval` and every tool that uses the network, files or settings.

Then cut a new release (below). UP Docs only moves when its `designer.lock.json` names the new
version.

## Cut a release

CI publishes the release. Two ways to trigger it:

- Tag the merged commit: `git tag up-docs-v<n> && git push origin up-docs-v<n>`.
- Run the workflow by hand: Actions, then "UP Docs release", then Run workflow, with
  version `up-docs-v<n>`. A new tag is created at that commit.

The release gets two files: `designer-up-docs-v<n>.tar.gz`, with the static app at the
archive root, and `designer-up-docs-v<n>.tar.gz.sha256`. The archive also holds
`up-docs-tools.json` and `up-docs-release.json` (version, commit, protocol). Check a release with:

```sh
gh release download up-docs-v<n> --repo riccardovandra/open-pencil
sha256sum -c designer-up-docs-v<n>.tar.gz.sha256
```

## Try a build without UP Docs

```sh
OPENPENCIL_SKIP_HTML_ENGINE_WASM=1 VITE_OPENPENCIL_CLOUD=off bun run build:packages
VITE_OPENPENCIL_CLOUD=off bunx vite build --base ./
bun tools/up-docs/harness.ts      # then open http://localhost:4611/
```

The harness serves the editor on its own origin (`:4610`, at `/` and `/designer/`). It also
serves a stand-in host page (`:4611`), which can embed the editor on the same origin with
`?editor=/designer/`. A third origin (`:4612`, for example `?parent=http://localhost:4611`)
shows the editor refusing a page it was not told about. The host page loads `public/demo.fig`
and acknowledges every save. Its `window.harness` gives the message log and the saves, and has
`saveNow()`, `flush()` and `reloadLastSave()`.
