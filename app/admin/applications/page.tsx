import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadApplicationBoard } from '@/lib/applicationTracking'
import { loadForwardBoard } from '@/lib/applicantForwards'
import { legacyApplicationsHref, parseStaffFilter, parseStageFilter } from '@/lib/applicationStageCore'
import { ADMIN_PAGE_SIZE, shownCount } from '@/lib/adminPagingCore'
import { applicationsView } from '@/lib/applicationsPagingCore'

import ApplicationsClient from './ApplicationsClient'
import { loadAppTemplates, loadSupportWhatsApp } from '@/lib/applicationTemplates'

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
//     are as in v2;
//   - Load more (owner, 28 Oct 2026): the tabs, the Staff filter, the stage
//     chips, the view, the search and every count are worked out HERE over the
//     whole board (lib/applicationsPagingCore). The browser gets 25 groups at a
//     time (?n=), the Older section its own 25 (?on=) and the "viewed the
//     number" list its own 25 (?vn=).

export const dynamic = 'force-dynamic'

type SP = { staff?: string; show?: string; tab?: string; view?: string; fwd?: string; q?: string; preview?: string; n?: string; on?: string; vn?: string }

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  // The Forward to parents tab is gone: its links open this page.
  if (sp.view === 'forward' || sp.fwd) permanentRedirect(legacyApplicationsHref(sp))
  const actor = await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const now = Date.now()
  const [board, forward, templates, supportDisplay] = await Promise.all([
    loadApplicationBoard(),
    loadForwardBoard(),
    loadAppTemplates(),
    loadSupportWhatsApp(),
  ])
  const staffFilter = parseStaffFilter(sp.staff, actor)
  const stageFilter = parseStageFilter(sp.show)
  const tab = sp.tab === 'sent' ? 'sent' : 'todo'
  const view = sp.view === 'tutor' ? 'tutor' : 'tuition'
  const q = sp.q ?? ''
  const v = applicationsView({
    rows: board.rows,
    nowMs: now,
    staffFilter,
    stageFilter,
    tab,
    view,
    q,
    shown: shownCount(sp.n),
    olderShown: shownCount(sp.on),
    viewedShown: shownCount(sp.vn),
    forwardCards: forward.cards,
    names: new Map(Object.entries(board.ownerNames)),
    actor: { id: actor.id, adminRole: actor.adminRole },
  })
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Applications</h2>
        <p className="text-xs text-gray-500">
          <b>To do</b>: the next follow-up is due. <b>Sent</b>: followed up and not due again yet — it comes back to To do on its due date.
          Applied is due now (“Forward overdue” after 1 day) — sending its WhatsApp to the parent shares the tutor’s profile, so it moves to Forwarded; Forwarded, Contacted and Demo/interview are due 3 days after the last
          follow-up or stage change (“Check in”); Hired, Not selected and No response need one message. The WhatsApp button writes to the
          parent or the tutor, depending on the stage. Tuitions posted more than 30 days ago are under “Older”. Staff and test accounts are
          left out. The wording of every message is in Team inbox → Templates → Applications.
        </p>
      </header>
      <ApplicationsClient
        view={v}
        staff={board.staff}
        actor={{ id: actor.id, adminRole: actor.adminRole }}
        staffFilter={staffFilter}
        stageFilter={stageFilter}
        tab={tab}
        listView={view}
        initialQuery={q}
        nowMs={now}
        olderPaged={shownCount(sp.on) > ADMIN_PAGE_SIZE}
        forwardTemplate={forward.template}
        canOpenMembers={roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors)}
        initialPreview={sp.preview ?? null}
        tutorUpdateTemplate={templates.get('app_tutor_update') ?? null}
        supportDisplay={supportDisplay}
      />
    </div>
  )
}
