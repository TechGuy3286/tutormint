import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { insightMembers } from '@/lib/insights'
import { actionLabel, isActionKey, requestNowMs, resolvePeriod } from '@/lib/insightsCore'

// Admin → Insights → the members behind one count (PR-12). The Owner and the
// Project Managers. Name and role only, each linked to the member's admin page —
// never a phone, email, CNIC or amount.

export const dynamic = 'force-dynamic'

type SP = { action?: string; from?: string; to?: string }

export default async function InsightMembersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdminRole(...SCREEN_ACCESS.insights)
  const sp = await searchParams
  const p = resolvePeriod({ period: 'custom', from: sp.from, to: sp.to }, requestNowMs())
  const back = `/admin/insights?period=custom&from=${p.from}&to=${p.to}`
  if (!isActionKey(sp.action)) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">Choose a number on Insights to see the members behind it.</p>
        <Link href={back} className="inline-flex min-h-[44px] items-center text-sm font-bold text-tm-navy underline">
          Back to Insights
        </Link>
      </div>
    )
  }
  const members = await insightMembers(sp.action, p.from, p.to)
  const admin = createAdminClient()
  const names = new Map<string, string>()
  if (admin && members.length) {
    const rows = await pageAllIn<Record<string, unknown>, string>(
      members.map((m) => m.id),
      (chunk, f, t) => admin.from('profiles').select('id, display_name, full_name, erased_at').in('id', chunk).order('id').range(f, t),
      100,
      READ_CONCURRENCY,
    )
    for (const r of rows) names.set(r.id as string, r.erased_at ? 'Deleted user' : ((r.display_name as string) || (r.full_name as string) || 'Member'))
  }
  const from = encodeURIComponent(`/admin/insights/members?action=${sp.action}&from=${p.from}&to=${p.to}`)
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">{actionLabel(sp.action)}</h2>
        <p className="text-xs text-slate-700">
          {p.label} (Pakistan time) · {members.length} member{members.length === 1 ? '' : 's'}, most first.
        </p>
        <Link href={back} className="inline-flex min-h-[44px] items-center text-xs font-bold text-tm-navy underline">
          Back to Insights
        </Link>
      </header>
      {members.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-700">Nobody in this period. Try a longer period on Insights.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {members.slice(0, 500).map((m) => (
            <li key={m.id} className="flex min-h-[48px] items-center justify-between gap-2 px-4 text-sm">
              <Link href={`/admin/users/${m.id}?from=${from}`} className="min-w-0 truncate font-bold text-tm-navy hover:underline">
                {names.get(m.id) ?? 'Member'}
              </Link>
              <span className="shrink-0 text-xs text-slate-700">
                {m.role === 'tutor' ? 'Tutor' : 'Parent'} · {m.count}×
              </span>
            </li>
          ))}
        </ul>
      )}
      {members.length > 500 && <p className="text-xs text-slate-700">Showing the first 500. Choose a shorter period to see the rest.</p>}
    </div>
  )
}
