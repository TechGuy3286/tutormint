import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadStaffActivity } from '@/lib/staffActivity'
import StaffActivityTable from '@/components/admin/StaffActivityTable'

// Every staff member with their activity counts (PR29 §2.3), read from the
// audit log by actor. Admin (and owner) only — a management view.

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operations: 'Operations',
}

export default async function StaffActivityPage() {
  await requireAdminRole(...SCREEN_ACCESS.staffActivity)
  const staff = await loadStaffActivity()

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
                <Link
                  href={`/admin/users/${s.id}`}
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
              <StaffActivityTable counts={s.counts} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
