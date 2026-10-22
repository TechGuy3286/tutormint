import Link from 'next/link'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadApplicationBoard } from '@/lib/applicationTracking'
import { loadForwardBoard } from '@/lib/applicantForwards'
import type { ForwardTab } from '@/lib/applicantForwardCore'
import { APPLICATIONS_PATH, parseStaffFilter, parseStageFilter } from '@/lib/applicationStageCore'

import ApplicationsClient from './ApplicationsClient'
import ForwardToParents from './ForwardToParents'

// Tuitions → Applications (owner, 22 Oct 2026). Its own page (it was a tab of
// Follow-ups; old links redirect here with their filters).
//   - a Staff filter (?staff=all | unassigned | <id>; staff open on their own
//     name, the site Owner on All) — anyone may view another staff member's
//     list; stage changes stay own-tuitions-only (the Owner any);
//   - one group per tuition; worked items sink to the bottom of their group,
//     fully worked groups to the bottom of the page, overdue back at the top;
//   - applications on tuitions posted more than 30 days ago sit in a collapsed
//     "Older" section, never overdue and never in a badge;
//   - search covers everything, Older and worked included.
// The "Forward to parents" board (?view=forward) is unchanged.

export const dynamic = 'force-dynamic'

const FORWARD_TABS: ForwardTab[] = ['to_forward', 'forwarded', 'outcome']

type SP = { staff?: string; show?: string; view?: string; fwd?: string; q?: string }

const subPill = (on: boolean) =>
  `inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
    on ? 'bg-tm-navy text-white' : 'border border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
  }`

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const sp = await searchParams
  const now = Date.now()

  if (sp.view === 'forward') {
    const board = await loadForwardBoard()
    const fwdTab = (FORWARD_TABS as string[]).includes(sp.fwd ?? '') ? (sp.fwd as ForwardTab) : 'to_forward'
    return (
      <div className="space-y-4">
        <Header />
        <nav aria-label="Applications view" className="flex flex-wrap gap-2">
          <Link href={APPLICATIONS_PATH} className={subPill(false)}>
            Applications
          </Link>
          <Link href={`${APPLICATIONS_PATH}?view=forward`} aria-current="page" className={subPill(true)}>
            Forward to parents <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-tm-navy">{board.counts.toForward}</span>
          </Link>
        </nav>
        <p className="text-xs text-slate-700">
          Tutors who paid the Verification Fee and applied to a tuition or viewed its number. Tell the parent once per tuition, then mark it
          as forwarded — each included application moves to Forwarded. The WhatsApp text is the “Applicants to forward” template (Team
          inbox → Templates).
        </p>
        <ForwardToParents
          cards={board.cards}
          counts={board.counts}
          template={board.template}
          tab={fwdTab}
          canOpenMembers={roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors)}
          nowMs={now}
        />
      </div>
    )
  }

  const [board, forwardBoard] = await Promise.all([loadApplicationBoard(), loadForwardBoard()])
  return (
    <div className="space-y-3">
      <Header />
      <nav aria-label="Applications view" className="flex flex-wrap gap-2">
        <Link href={APPLICATIONS_PATH} aria-current="page" className={subPill(true)}>
          Applications
        </Link>
        <Link href={`${APPLICATIONS_PATH}?view=forward`} className={subPill(false)}>
          Forward to parents{' '}
          <span className="rounded-full bg-tm-tint-navy px-1.5 py-0.5 text-[10px] text-tm-navy">{forwardBoard.counts.toForward}</span>
        </Link>
      </nav>
      <ApplicationsClient
        rows={board.rows}
        staff={board.staff}
        ownerNames={board.ownerNames}
        actor={{ id: actor.id, adminRole: actor.adminRole }}
        staffFilter={parseStaffFilter(sp.staff, actor)}
        stageFilter={parseStageFilter(sp.show)}
        initialQuery={sp.q ?? ''}
        nowMs={now}
      />
    </div>
  )
}

function Header() {
  return (
    <header className="space-y-1">
      <h2 className="text-lg font-black text-tm-navy">Applications</h2>
      <p className="text-xs text-gray-500">
        Grouped by tuition. A tuition&apos;s applications belong to its owner — the staff member who posted it, or its city&apos;s owner.
        “Forward overdue”: Applied for more than 1 day. “Check in”: no update for more than 3 days. Anything you do — a stage change, a
        WhatsApp check-in or a forward — moves the row to the bottom until it is due again. Tuitions posted more than 30 days ago are under
        “Older”. Staff and test accounts are left out.
      </p>
    </header>
  )
}
