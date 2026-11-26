import { reportBootFailure, runSupportGate } from '@/app/shell/support/gate'

// Keep this module free of the app bundle: it must evaluate on engines that
// cannot run the app so it can explain why (see src/app/shell/support/).
async function start(): Promise<void> {
  if (!(await runSupportGate())) return
  try {
    // A Cloud server's root welcomes visitors who are not signed in before loading the editor.
    if (__OPENPENCIL_CLOUD_SITE__) {
      const { enterCloudSite } = await import('@/app/cloud-portal/site')
      if (!(await enterCloudSite())) return
    }
    const { boot } = await import('./boot')
    await boot()
  } catch (error) {
    // UP Docs host: tell the page around the editor why it did not start.
    if (new URLSearchParams(window.location.search).get('host') === 'up-docs') {
      const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
      window.parent.postMessage({ type: 'up-designer:boot-failed', error: detail }, '*')
    }
    await reportBootFailure(error)
  }
}

void start()
