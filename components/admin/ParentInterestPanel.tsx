import 'server-only'

import Link from 'next/link'

import InterestInboxRow from '@/components/admin/InterestInboxRow'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminActor } from '@/lib/adminAuth'
import { seesAllRows } from '@/lib/staffAllRows'
import { loadParentInterestPanel } from '@/lib/interestInbox'
import { inboxView } from '@/lib/interestInboxView'
import { INBOX_HREF, WAIT_LABEL } from '@/lib/interestInboxCore'
import { WA_WEEKLY_CAP } from '@/lib/tutorTeasersCore'

// The "Parent interest" panel on a parent's member page (PR-10, owner 19 Nov
// 2026): every tutor this parent viewed, shortlisted, tried to message or asked
// for a demo in the last 30 days — one row per tutor with this parent's actions
// and dates — and the tutor's shared inbox row with the same Send / Sent / Undo
// (one log: a tutor sent here is Sent on People → WhatsApp updates too). Held,
// staff and test parents show only "Activity held — not used for tutor
// messages". SCREEN_ACCESS.interestInbox; Managers and Tuitions staff send only
// their own rows.

export default async function ParentInterestPanel({ parentId, actor }: { parentId: string; actor: AdminActor }) {
  const panel = await loadParentInterestPanel(parentId)
  const seesAll = await seesAllRows(actor, SCREEN_ACCESS.interestInboxAll)
  const mayWrite = roleMayWrite(actor.adminRole, SCREEN_ACCESS.interestInbox)
  const canReveal = roleSatisfies(actor.adminRole, SCREEN_ACCESS.memberContactReveal)
  const nowMs = Date.now()
  return (
    <section id="parent-interest" className="scroll-mt-20 space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-parent-interest="">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">Parent interest</h2>
        <Link href={INBOX_HREF} className="text-xs font-bold text-tm-navy underline">
          Open the inbox
        </Link>
      </div>
      {panel.state === 'held' ? (
        <p className="text-xs font-semibold text-gray-600" data-parent-interest-held="">
          {panel.label}
        </p>
      ) : panel.rows.length === 0 ? (
        <p className="text-xs text-gray-600">No tutor views, shortlists, messages or demo requests by this parent in the last 30 days. Activity shows here as soon as it happens.</p>
      ) : (
        <ul className="space-y-2">
          {panel.rows.map((r) => (
            <li key={r.tutorId}>
              <InterestInboxRow
                row={inboxView(r, actor, nowMs, (w) => WAIT_LABEL[w])}
                canSend={mayWrite && (seesAll || r.assigneeId === actor.id)}
                canReveal={canReveal}
                from="parent_page"
                cap={WA_WEEKLY_CAP}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
