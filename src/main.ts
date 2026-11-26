import { postUpDocsError } from '@/app/host/up-docs/channel'
import { reportBootFailure, runSupportGate } from '@/app/shell/support/gate'

// Keep this module free of the app bundle: it must evaluate on engines that
// cannot run the app so it can explain why (see src/app/shell/support/).
async function start(): Promise<void> {
  if (!(await runSupportGate())) {
    // An UP Docs page shows its own message rather than a frame it cannot explain.
    postUpDocsError('unsupported-browser', 'This browser cannot run the editor')
    return
  }
  try {
    // A Cloud server's root welcomes visitors who are not signed in before loading the editor.
    if (__OPENPENCIL_CLOUD_SITE__) {
      const { enterCloudSite } = await import('@/app/cloud-portal/site')
      if (!(await enterCloudSite())) return
    }
    const { boot } = await import('./boot')
    await boot()
  } catch (error) {
    postUpDocsError('boot-failed', error)
    await reportBootFailure(error)
  }
}

void start()
