import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadStaffDetail } from '@/lib/staffActivity'
import { STAFF_METRICS, type StaffMetricKey } from '@/lib/staffActivityCore'
import StaffActivityTable from '@/components/admin/StaffActivityTable'
import { formatDateTime } from '@/lib/datetime'

// One staff member's activity in detail (PR40 §4): the counts, a by-city and
// open/paused/closed breakdown of the tuitions they posted, and the actual
// actions newest-first — each line opening the tuition or the member. Filters by
// action and date; all from the audit log.

export const dynamic = 'force-dynamic'

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000
function startOfKarachiToday(): string {
  const shifted = Date.now() + KARACHI_OFFSET_MS
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000 - KARACHI_OFFSET_MS
  return new Date(dayStart).toISOString()
}

const METRIC_KEYS = new Set(STAFF_METRICS.map((m) => m.key as string))

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ action?: string; period?: string; from?: string; to?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.staffActivity)
  const { id } = await params
  const sp = await searchParams

  const admin = createAdminClient()
  const { data: staff } = admin
    ? await admin.from('profiles').select('id, full_name, email, admin_role, role').eq('id', id).maybeSingle()
    : { data: null }
  if (!staff || staff.role !== 'admin') notFound()

  const metric: StaffMetricKey | null =
    sp.action && METRIC_KEYS.has(sp.action) ? (sp.action as StaffMetricKey) : null

  // The window from ?period= (what the count links pass) or explicit ?from/?to.
  let from = sp.from || undefined
  if (!from) {
    if (sp.period === 'today') from = startOfKarachiToday()
    else if (sp.period === 'week') from = new Date(Date.now() - 7 * 86_400_000).toISOString()
  }
  const to = sp.to || undefined

  const detail = await loadStaffDetail(id, { metric, from, to })
  const name = (staff.full_name as string | null) ?? '—'
  const metricLabel = metric ? STAFF_METRICS.find((m) => m.key === metric)?.label : null

  const link = 'rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-bold hover:border-tm-navy'
  const activeLink = 'rounded-lg border border-tm-navy bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy'
  const card = 'space-y-2 rounded-2xl border border-gray-200 bg-white p-4'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-tm-navy">{name}</h1>
          <Link href={`/admin/users/${id}`} className="text-[11px] font-bold text-tm-red hover:underline">
            Member record →
          </Link>
        </div>
        <Link href="/admin/staff-activity" className="text-[11px] font-bold text-tm-navy hover:underline">
          ← All staff
        </Link>
      </div>

      {/* The same counts as the list — numbers here re-filter the list below. */}
      <div className={card}>
        <StaffActivityTable counts={detail.counts} staffId={id} />
      </div>

      {/* Tuitions posted, by city + current status. */}
      {detail.cityCounts.length > 0 && (
        <div className={card}>
          <p className="text-xs font-black text-tm-navy">Tuitions posted</p>
          <p className="text-[11px] text-gray-600">
            {detail.cityCounts.map((c) => `${c.city} ${c.count}`).join(' · ')}
          </p>
          <p className="text-[11px] text-gray-600">
            Now: <span className="font-bold text-tm-green-deep">{detail.postedStatus.open} open</span> ·{' '}
            <span className="font-bold text-tm-navy">{detail.postedStatus.paused} paused</span> ·{' '}
            <span className="font-bold text-gray-500">{detail.postedStatus.closed} closed</span>
          </p>
        </div>
      )}

      {/* Filters: action + date range. Plain GET form so it works without JS. */}
      <form className={card} method="get">
        <p className="text-xs font-black text-tm-navy">Filter</p>
        <div className="flex flex-wrap gap-1.5">
          <Link href={`/admin/staff-activity/${id}`} className={!metric ? activeLink : link}>
            All actions
          </Link>
          {STAFF_METRICS.map((m) => (
            <Link
              key={m.key}
              href={`/admin/staff-activity/${id}?action=${m.key}`}
              className={metric === m.key ? activeLink : link}
            >
              {m.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {metric && <input type="hidden" name="action" value={metric} />}
          <label className="text-[11px] font-semibold text-gray-600">
            From
            <input type="date" name="from" defaultValue={sp.from ?? ''} className="mt-0.5 block rounded-lg border border-gray-200 px-2 py-1 text-xs" />
          </label>
          <label className="text-[11px] font-semibold text-gray-600">
            To
            <input type="date" name="to" defaultValue={sp.to ?? ''} className="mt-0.5 block rounded-lg border border-gray-200 px-2 py-1 text-xs" />
          </label>
          <button type="submit" className="inline-flex min-h-[32px] items-center rounded-lg bg-tm-navy px-3 text-[11px] font-bold text-white">
            Apply
          </button>
        </div>
      </form>

      {/* The actions themselves, newest first. Each opens the thing. */}
      <div className={card}>
        <p className="text-xs font-black text-tm-navy">
          {metricLabel ?? 'All activity'}
          <span className="ml-1 font-semibold text-gray-500">({detail.items.length})</span>
        </p>
        {detail.items.length === 0 ? (
          <p className="text-[11px] text-gray-500">Nothing in this view.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.items.map((it) => (
              <li key={it.id}>
                <Link href={it.href} className="flex items-center justify-between gap-3 py-2 hover:bg-tm-bg">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-tm-navy">{it.title}</span>
                    <span className="block text-[11px] text-gray-500">{it.sub}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-500">{formatDateTime(it.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
