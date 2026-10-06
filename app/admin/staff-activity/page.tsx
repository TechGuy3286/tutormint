import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadStaffActivity, loadTuitionActivity } from '@/lib/staffActivity'
import { formatDateTime } from '@/lib/datetime'
import StaffActivityTable from '@/components/admin/StaffActivityTable'
import { recentRepeats } from '@/lib/duplicates'

// Every staff member with their activity counts (PR29 §2.3), read from the
// audit log by actor. Admin (and owner) only — a management view.

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operations: 'Operations',
  tuitions_staff: 'Tuitions staff',
}

export default async function StaffActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; days?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.staffActivity)
  // The restricted Tuitions staff role (owner, 6 Oct 2026, item 18) sees
  // tuition-posting activity ONLY — posts, edits, reopens, refreshes, closes,
  // merges and duplicate warnings — for themselves and the other staff. The
  // loader reads only those audit actions, so no payment, member,
  // verification, role or settings row reaches this view. Owner and admin keep
  // the full view below, unchanged.
  if (actor.adminRole === 'tuitions_staff') {
    const sp = await searchParams
    return <TuitionActivityView person={sp.person ?? null} days={sp.days === '7' ? 7 : 30} />
  }
  const staff = await loadStaffActivity()
  // Repeats this week per staff member (owner, 6 Oct 2026, item 16): the
  // Duplicates view's count, shown here too.
  const repeats = await recentRepeats(new Date(Date.now() - 7 * 86_400_000))
  const repeatsByName = new Map<string, number>()
  for (const p of repeats) {
    const k = (p.repeat.postedBy ?? '').toLowerCase()
    repeatsByName.set(k, (repeatsByName.get(k) ?? 0) + 1)
  }

  return (
    <div className="space-y-4">
      {staff.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
          No staff accounts yet.
        </p>
      ) : (
        <div className="space-y-3">
          {staff.map((s) => (
            <section key={s.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {/* The name opens this staff member's detail page unfiltered
                    (PR40 §4); the numbers below open it filtered. */}
                <Link
                  href={`/admin/staff-activity/${s.id}`}
                  className="text-sm font-black text-tm-navy hover:text-tm-red hover:underline"
                >
                  {s.name}
                </Link>
                <span className="flex items-center gap-2 text-[11px]">
                  {s.email && <span className="text-gray-500">{s.email}</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold uppercase text-slate-700">
                    {ROLE_LABEL[s.adminRole ?? ''] ?? s.adminRole ?? '—'}
                  </span>
                </span>
              </div>
              <StaffActivityTable counts={s.counts} staffId={s.id} />
              <p className="text-[11px] text-gray-500">
                Repeated tuitions this week:{' '}
                <Link href="/admin/jobs/duplicates" className={`font-bold ${(repeatsByName.get(s.name.toLowerCase()) ?? 0) > 0 ? 'text-tm-red' : 'text-tm-navy'} hover:underline`}>
                  {repeatsByName.get(s.name.toLowerCase()) ?? 0}
                </Link>
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

async function TuitionActivityView({ person, days }: { person: string | null; days: 7 | 30 }) {
  const feed = await loadTuitionActivity({ person, sinceDays: days })
  const chip = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-tm-navy'
  const on = 'rounded-lg border border-tm-navy bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy'
  const qs = (p: string | null, d: number) => {
    const u = new URLSearchParams()
    if (p) u.set('person', p)
    if (d !== 30) u.set('days', String(d))
    const s = u.toString()
    return `/admin/staff-activity${s ? `?${s}` : ''}`
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">
        Tuition posting by every member of staff: posts, edits, reopens, refreshes, closes, merges and posts made after a duplicate warning. Read only.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Link href={qs(null, days)} className={!person ? on : chip}>Everyone</Link>
        {feed.staff.map((s) => (
          <Link key={s.id} href={qs(s.id, days)} className={person === s.id ? on : chip}>{s.name}</Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Link href={qs(person, 7)} className={days === 7 ? on : chip}>Last 7 days</Link>
        <Link href={qs(person, 30)} className={days === 30 ? on : chip}>Last 30 days</Link>
      </div>
      <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-black text-tm-navy">
          Tuition activity <span className="font-semibold text-gray-500">({feed.items.length})</span>
        </p>
        {feed.items.length === 0 ? (
          <p className="text-[11px] text-gray-500">No tuition activity in this view.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {feed.items.map((it) => (
              <li key={it.id}>
                <Link href={it.href} className="flex items-start justify-between gap-3 py-2 hover:bg-tm-bg">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-tm-navy">
                      {it.refId ? `${it.refId} · ` : ''}{it.title}
                    </span>
                    <span className="block text-[11px] text-gray-600">
                      {it.actorName} — {it.label}
                    </span>
                    {it.reason && (
                      <span className="block text-[11px] text-gray-500">Reason: {it.reason}</span>
                    )}
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
