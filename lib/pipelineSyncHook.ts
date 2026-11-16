import 'server-only'

// lib/pipelineSyncHook.ts — PR-02 (owner, 16 Nov 2026).
//
// After any logged change to a member (lib/activityLog, lib/auditLog), that
// tutor's stored People card is rebuilt live and the badge / Overview figures
// nudged (lib/tutorPipeline syncPipelineRowAfterChange). It runs AFTER the
// response is sent (next/server after()), so:
//   - the caller is never slowed down or broken by it;
//   - a route that moves the card itself (a follow-up, Not interested, a
//     document review) has already done so and returned the card before/after
//     to the page — the later sync finds nothing left to change.
// Outside a request (a cron step, a script) it runs straight away. Never throws.

export async function syncPipelineSoon(memberId: string | null | undefined): Promise<void> {
  if (!memberId) return
  const run = async () => {
    try {
      const { syncPipelineRowAfterChange } = await import('@/lib/tutorPipeline')
      await syncPipelineRowAfterChange(memberId)
    } catch {
      /* the next summary run puts it right */
    }
  }
  try {
    const { after } = await import('next/server')
    after(run)
  } catch {
    await run()
  }
}
