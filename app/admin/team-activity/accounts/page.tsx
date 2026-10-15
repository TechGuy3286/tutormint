import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { formatDateTime } from '@/lib/datetime'
import { loadSignupList } from '@/lib/staffSignups'
import { maskMobile } from '@/lib/smsHealthCore'
import { PERIODS, currentStep, isInProgressStep, isInProgressStepFor, isListStep, parsePeriod, stepsFor, type MemberRole, type Step } from '@/lib/staffSignupsCore'
import { isMonthKey, monthLabel, monthRange } from '@/lib/staffTargetsCore'
import { teamActivityHref } from '@/lib/teamActivityCore'

// The accounts behind one number on Team activity → Paid sign-ups (owner, 15
// Oct 2026): name, masked mobile, the date of that step and where the account
// is now, so staff can follow up. `inprogress=1` lists only tutors who have NOT
// paid (the "In progress (not counted)" block). A participant may open only
// their own lists — another person's id or the Team total is refused on the
// server (lib/staffSignups loadSignupList; the JSON route answers 403).

export const dynamic = 'force-dynamic'

export default async function SignupListPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; role?: string; step?: string; period?: string; month?: string; inprogress?: string }>
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
  const back = month ? teamActivityHref('paid', { month }) : teamActivityHref('paid')
  const result = await loadSignupList(actor, staff, role, step, period, undefined, {
    inProgress,
    range: month ? monthRange(month) : undefined,
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

  const stepLabel = step === 'paid' ? 'Paid' : (stepsFor(role).find((s) => s.key === step)?.label ?? '')
  const periodLabel = month ? monthLabel(month) : (PERIODS.find((p) => p.key === period)?.label ?? '')
  const n = result.accounts.length
  const noun = role === 'tutor' ? (n === 1 ? 'tutor' : 'tutors') : n === 1 ? 'parent' : 'parents'

  return (
    <div className="space-y-3">
      <Link href={back} className="text-xs font-bold text-tm-navy hover:underline">
        ← Back to Team activity
      </Link>
      <h1 className="text-base font-black text-tm-navy">
        {result.staffName}: {n} {noun} · {stepLabel}
        {inProgress ? ' · not paid yet' : ''} · {periodLabel}
      </h1>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Mobile</th>
              <th className="px-3 py-2">{stepLabel}</th>
              <th className="px-3 py-2">Now at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {n === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-gray-500">
                  Nobody here for this period.
                </td>
              </tr>
            )}
            {result.accounts.map((a) => (
              <tr key={a.memberId} className="text-slate-800">
                <td className="px-3 py-2 font-bold">{a.name}</td>
                <td className="px-3 py-2 tabular-nums">{maskMobile(a.mobile)}</td>
                <td className="px-3 py-2">{a.at[step] ? formatDateTime(a.at[step] as string) : '—'}</td>
                <td className="px-3 py-2">{currentStep(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
