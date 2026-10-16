import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadSignupList } from '@/lib/staffSignups'
import { rowsForAccounts } from '@/lib/mySignups'
import SignupRows from '@/components/admin/SignupRows'
import { PERIODS, isInProgressStep, isStaffStatus, isInProgressStepFor, isListStep, parsePeriod, stepsFor, type MemberRole, type Step } from '@/lib/staffSignupsCore'
import { isMonthKey, monthLabel, monthRange } from '@/lib/staffTargetsCore'
import { teamActivityHref } from '@/lib/teamActivityCore'

// The accounts behind one number on Team activity → Paid sign-ups (owner, 15
// Oct 2026), with the same columns as My sign-ups (owner, 16 Oct 2026): name,
// full phone, email, city, step, next step, Counted / Not counted and a
// WhatsApp button, so staff can follow up. `inprogress=1` lists only tutors who have NOT
// paid (the "In progress (not counted)" block). A participant may open only
// their own lists — another person's id or the Team total is refused on the
// server (lib/staffSignups loadSignupList; the JSON route answers 403).

export const dynamic = 'force-dynamic'

export default async function SignupListPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; role?: string; step?: string; period?: string; month?: string; inprogress?: string; status?: string; unpaid?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tuitionPosting)
  const sp = await searchParams
  const role: MemberRole = sp.role === 'parent' ? 'parent' : 'tutor'
  const step: Step = isListStep(role, sp.step) ? sp.step : 'signed_up'
  const period = parsePeriod(sp.period)
  // A calendar month (owner, 16 Oct 2026) — the Paid sign-ups board links here
  // with ?month=YYYY-MM; the older ?period= links still work.
  const month = isMonthKey(sp.month) ? sp.month : null
  const staff = sp.staff ?? actor.id
  const inProgress = sp.inprogress === '1' && (month ? isInProgressStepFor(role, step) : role === 'tutor' && isInProgressStep(step))
  // Pending / Signed up (owner, 16 Oct 2026) — the two statuses on Team
  // activity; only with a month.
  const status = month && isStaffStatus(sp.status) ? sp.status : null
  const back = month ? teamActivityHref('paid', { month }) : teamActivityHref('paid')
  const result = await loadSignupList(actor, staff, role, step, period, undefined, {
    inProgress,
    range: month ? monthRange(month) : undefined,
    status: status ?? undefined,
    // "All unpaid" from a staff card (owner, 17 Oct 2026): tutors and parents,
    // any month.
    unpaidAll: sp.unpaid === 'all',
  })

  if (!result.ok) {
    return (
      <div className="space-y-3">
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm font-bold text-tm-red">{result.error}</p>
        <Link href={back} className="text-xs font-bold text-tm-navy hover:underline">
          Back to Team activity
        </Link>
      </div>
    )
  }

  const stepLabel = status === 'pending' ? 'Pending (not paid)' : status === 'signed_up' ? 'Signed up (paid)' : step === 'paid' ? 'Paid' : (stepsFor(role).find((s) => s.key === step)?.label ?? '')
  const periodLabel = month ? monthLabel(month) : (PERIODS.find((p) => p.key === period)?.label ?? '')
  const n = result.accounts.length
  // The same columns as My sign-ups (owner, 16 Oct 2026): full phone, email,
  // city, step, next step, counted — the viewer may open this list.
  const rows = await rowsForAccounts(result.accounts)
  const unpaidAll = sp.unpaid === 'all'
  const noun = unpaidAll ? (n === 1 ? 'person' : 'people') : role === 'tutor' ? (n === 1 ? 'tutor' : 'tutors') : n === 1 ? 'parent' : 'parents'

  return (
    <div className="space-y-3">
      <Link href={back} className="text-xs font-bold text-tm-navy hover:underline">
        ← Back to Team activity
      </Link>
      <h1 className="text-base font-black text-tm-navy">
        {unpaidAll ? (
          <>
            {result.staffName}: {n} {noun} · Not paid · All time
          </>
        ) : (
          <>
            {result.staffName}: {n} {noun} · {stepLabel}
            {inProgress && !status ? ' · not paid yet' : ''} · {periodLabel}
          </>
        )}
      </h1>
      {n === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nobody here for this period.</p>
      ) : (
        <SignupRows rows={rows} showFilters />
      )}
    </div>
  )
}
