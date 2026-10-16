import Link from 'next/link'
import { after } from 'next/server'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadMySignupsPage, logMySignupsOpen } from '@/lib/mySignups'
import { HOW_CREDIT_WORKS, EMPTY_STATE } from '@/lib/mySignupsCore'
import { isParticipantRole } from '@/lib/staffSignupsCore'
import { PACE_LABEL, monthLabel, perDayLabel, type PaceStatus } from '@/lib/staffTargetsCore'
import { formatDate } from '@/lib/datetime'
import JoinLinkCard from '@/components/admin/JoinLinkCard'
import SignupRows from '@/components/admin/SignupRows'

// Tuitions → My sign-ups (owner, 16 Oct 2026). Each staff member sees ONLY the
// people credited to their own join link, code or approved claim — cut on the
// server (lib/mySignups takes the signed-in actor's own id) and, since
// migration 182, refused to another staff token by the database too.
//
// Top: the month card. Staff on this month's target list see "Paid this month:
// X of <target>", the pace and "Counting starts <date>" — the same numbers as
// their Team activity card (same loader). Everyone else ("in-house") sees the
// paid count only. Then the join link and code, "How credit works", and the
// list. Every open of this page is written to the staff activity log.

export const dynamic = 'force-dynamic'

const STATUS_CHIP: Record<PaceStatus, string> = {
  on_pace: 'bg-tm-tint-green text-tm-green-deep',
  slightly_behind: 'bg-tm-tint-gold text-tm-gold-ink',
  behind: 'bg-tm-tint-red text-tm-red',
}

export default async function MySignupsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.mySignups)

  if (!isParticipantRole(actor.adminRole)) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-black text-tm-navy">My sign-ups</h1>
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-700">
          Your account has no join link, so there is nothing to show here. Every staff member&rsquo;s sign-ups are on{' '}
          <Link href="/admin/team-activity" className="font-bold text-tm-red hover:underline">
            Team activity
          </Link>
          .
        </p>
      </div>
    )
  }

  const page = await loadMySignupsPage(actor.id)
  after(() => logMySignupsOpen(actor, page.rows.length))
  const card = page.card
  const label = monthLabel(card.month)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black text-tm-navy">My sign-ups</h1>

      {card.kind === 'target' ? (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-gray-600">{label}</h2>
            {card.card.pace.status && (
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_CHIP[card.card.pace.status]}`}>
                {PACE_LABEL[card.card.pace.status]}
              </span>
            )}
          </div>
          <p className="text-2xl font-black tabular-nums text-tm-navy">
            Paid this month: {card.card.pace.paid}
            {card.card.pace.target ? ` of ${card.card.pace.target}` : ''}
          </p>
          <p className="text-xs text-slate-700">
            {card.card.pace.reached ? (
              <span className="font-bold text-tm-green-deep">Target reached ✓</span>
            ) : card.card.pace.neededPerDay != null ? (
              <>
                Needed per day: <strong className="tabular-nums">{perDayLabel(card.card.pace.neededPerDay)}</strong> · {card.card.pace.daysLeft} days left
              </>
            ) : null}
          </p>
          <p className="text-[11px] text-gray-600">Counting starts {formatDate(`${card.countingStarts}T00:00:00+05:00`)}.</p>
        </section>
      ) : (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-bold text-gray-600">{label}</h2>
          <p className="text-2xl font-black tabular-nums text-tm-navy">Paid this month: {card.paid}</p>
        </section>
      )}

      {page.link && <JoinLinkCard url={page.link.url} code={page.link.code} />}

      <details className="rounded-2xl border border-gray-200 bg-white p-4">
        <summary className="min-h-[44px] cursor-pointer text-sm font-black text-tm-navy">How credit works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
          {HOW_CREDIT_WORKS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      {page.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-700">{EMPTY_STATE}</p>
      ) : (
        <SignupRows rows={page.rows} showFilters />
      )}
    </div>
  )
}
