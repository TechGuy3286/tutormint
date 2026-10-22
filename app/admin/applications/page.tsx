import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadApplicationBoard } from '@/lib/applicationTracking'
import { loadForwardBoard } from '@/lib/applicantForwards'
import { legacyApplicationsHref, parseStaffFilter, parseStageFilter } from '@/lib/applicationStageCore'

import ApplicationsClient from './ApplicationsClient'

// Tuitions → Applications (owner, 22 Oct 2026; Applications v3).
//   - two tabs: "To do" (the next follow-up is due) and "Sent" (followed up,
//     not due again yet) — lib/applicationFollowUpCore; the Older section
//     (tuitions posted 30+ days ago) is collapsed at the bottom of To do;
//   - two views: "By tuition" (default) and "By tutor" (?view=tutor);
//   - each row's WhatsApp button writes to the parent or the tutor by stage,
//     with the stage's message (lib/applicationMessagesCore), and records a
//     follow-up with a 10-second Undo;
//   - each tuition group's "Forward to parents" button opens the panel that
//     replaced the separate Forward to parents tab (its old links land here);
//   - the Staff filter, stage chips, search, city owners and stage edit rights
//     are as in v2.

export const dynamic = 'force-dynamic'

type SP = { staff?: string; show?: string; tab?: string; view?: string; fwd?: string; q?: string; preview?: string }

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  // The Forward to parents tab is gone: its links open this page.
  if (sp.view === 'forward' || sp.fwd) permanentRedirect(legacyApplicationsHref(sp))
  const actor = await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const now = Date.now()
  const [board, forward] = await Promise.all([loadApplicationBoard(), loadForwardBoard()])
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Applications</h2>
        <p className="text-xs text-gray-500">
          <b>To do</b>: the next follow-up is due. <b>Sent</b>: followed up and not due again yet — it comes back to To do on its due date.
          Applied is due now (“Forward overdue” after 1 day); Forwarded, Contacted and Demo/interview are due 3 days after the last
          follow-up or stage change (“Check in”); Hired, Not selected and No response need one message. The WhatsApp button writes to the
          parent or the tutor, depending on the stage. Tuitions posted more than 30 days ago are under “Older”. Staff and test accounts are
          left out.
        </p>
      </header>
      <ApplicationsClient
        rows={board.rows}
        staff={board.staff}
        ownerNames={board.ownerNames}
        actor={{ id: actor.id, adminRole: actor.adminRole }}
        staffFilter={parseStaffFilter(sp.staff, actor)}
        stageFilter={parseStageFilter(sp.show)}
        tab={sp.tab === 'sent' ? 'sent' : 'todo'}
        view={sp.view === 'tutor' ? 'tutor' : 'tuition'}
        initialQuery={sp.q ?? ''}
        nowMs={now}
        forwardCards={forward.cards}
        forwardTemplate={forward.template}
        canOpenMembers={roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors)}
        initialPreview={sp.preview ?? null}
      />
    </div>
  )
}
