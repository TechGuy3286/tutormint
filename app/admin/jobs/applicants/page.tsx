import { getAdminActor, requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { roleSatisfies } from '@/lib/adminAccessCore'
import { loadForwardBoard } from '@/lib/applicantForwards'
import type { ForwardTab } from '@/lib/applicantForwardCore'
import ApplicantsClient from './ApplicantsClient'

// Marketplace → Applicants to forward (owner, 10 Oct 2026). When a tutor who
// has paid the Verification Fee applies to a tuition or views its contact
// number, staff tell that tuition's parent. One card per tuition. Owner, admin,
// operations and tuitions staff act; the Partner sees every card, no buttons.
// Nothing here is shown to tutors or parents.

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Applicants to forward', robots: { index: false } }

const TABS: ForwardTab[] = ['to_forward', 'forwarded', 'outcome']

export default async function ApplicantsToForwardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const sp = await searchParams
  const tab = (TABS as string[]).includes(sp.tab ?? '') ? (sp.tab as ForwardTab) : 'to_forward'
  const [board, actor] = await Promise.all([loadForwardBoard(), getAdminActor()])
  const canOpenMembers = !!actor && roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Applicants to forward</h1>
        <p className="text-xs text-slate-700">
          Tutors who paid the Verification Fee and applied to a tuition or viewed its number. Tell the parent once per tuition, then
          mark it as forwarded. The WhatsApp text is the “Applicants to forward” template (Team inbox → Templates).
        </p>
        <p className="text-[11px] text-gray-600">
          {board.counts.toForward} to forward · {board.counts.paidTutors} paid {board.counts.paidTutors === 1 ? 'tutor' : 'tutors'} involved ·{' '}
          {board.counts.applications} applications and {board.counts.views} number views counted
        </p>
      </header>
      <ApplicantsClient
        cards={board.cards}
        counts={board.counts}
        template={board.template}
        tab={tab}
        canOpenMembers={canOpenMembers}
        // The server's clock, handed down so both renders write the same words.
        // eslint-disable-next-line react-hooks/purity -- a server component: this runs once per request
        nowMs={Date.now()}
      />
    </div>
  )
}
