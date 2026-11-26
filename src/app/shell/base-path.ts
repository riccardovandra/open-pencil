/**
 * The path the app is served under, ending in `/`. A build with a relative base
 * (`vite build --base ./`, as UP Docs ships it) runs under any path, such as `/` on its own
 * address or `/designer/` beside another app; Vite then gives `BASE_URL` as `./`, so the path is
 * found from this module's own address, as every chunk but Shiki's data sits in `assets/`.
 */
// Code run outside Vite, such as unit tests under Bun, has no `BASE_URL` and runs at `/`.
const env: Record<string, unknown> = import.meta.env
const viteBase = typeof env.BASE_URL === 'string' ? env.BASE_URL : '/'
export const APP_BASE_PATH: string = viteBase.startsWith('/')
  ? viteBase
  : new URL('../', import.meta.url).pathname

/** The address of a file in `public/`, such as `brand/app-icon.svg`, under the app's path. */
export function publicAssetPath(file: string): string {
  return `${APP_BASE_PATH}${file}`
}
