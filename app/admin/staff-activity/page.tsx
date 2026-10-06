import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadStaffActivity } from '@/lib/staffActivity'
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

export default async function StaffActivityPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.staffActivity)
  // The restricted tuitions_staff role sees ONLY its own activity — not the
  // team list. Send it straight to its own detail page, which refuses any
  // other id for this role.
  if (actor.adminRole === 'tuitions_staff') redirect(`/admin/staff-activity/${actor.id}`)
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
