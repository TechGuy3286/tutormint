import { requireAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { ViewOnlyNotice } from '@/components/admin/ReadOnly'
import { MODE_STAGES } from '@/lib/followUpModeCore'
import { STAGE_LABEL, type FollowStage } from '@/lib/tutorPipelineCore'
import FollowUpModeClient from './FollowUpModeClient'

// People → "Start follow-ups" (owner, 23 Nov 2026 — PR-18 Part B). One tutor at
// a time for a stage: the stage's WhatsApp message, Open WhatsApp, then Sent /
// No answer / Not interested / Skip, and the next tutor opens by itself. Phones
// stay masked; the WhatsApp link is built on the server when it is pressed.

export const dynamic = 'force-dynamic'

export default async function FollowUpModePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.unpaidSignups)
  const sp = await searchParams
  const raw = Array.isArray(sp.stage) ? sp.stage[0] : sp.stage
  const stage: FollowStage = (MODE_STAGES as readonly string[]).includes(raw ?? '') ? (raw as FollowStage) : 'missing'
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Follow-ups: {STAGE_LABEL[stage]}</h1>
        <p className="text-xs text-gray-600">
          One tutor at a time, the ones due now. While a tutor is open here nobody else gets them (for 10 minutes, or until you
          record what happened).
        </p>
      </header>
      {roleMayWrite(actor.adminRole, SCREEN_ACCESS.unpaidSignups) ? (
        <FollowUpModeClient stage={stage} stages={MODE_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} />
      ) : (
        <ViewOnlyNotice what="Follow-ups" />
      )}
    </div>
  )
}
