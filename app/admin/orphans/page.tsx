import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { formatDate } from '@/lib/datetime'
import { AlertTriangle } from 'lucide-react'

// Orphaned accounts: auth users with no profiles row. See lib/adminOrphans.ts.
// Read-only and deliberately so — this exists to make a silent failure visible,
// not to act on it. Backfilling is a reviewed migration (see 59/60), not a
// one-click button that could mint a wrong-role account in bulk.

export const dynamic = 'force-dynamic'

export default async function AdminOrphansPage() {
  await requireAdminRole(...SCREEN_ACCESS.orphans)
  const { rows, ok } = await loadOrphanedAccounts()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-black text-tm-navy">Orphaned accounts</h1>
        <p className="text-xs text-gray-500">
          Auth users with no profile row. These are invisible to the tutor and member lists, so
          they are shown here — the failure that hid 24 real signups for three days.
        </p>
      </div>

      {!ok && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          Could not enumerate auth users (SUPABASE_SERVICE_ROLE_KEY missing, or the Auth API
          refused). The list may be incomplete.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-6 text-center text-xs font-bold text-tm-green-deep">
          No orphaned accounts. Every auth user has a profile.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3 text-[11px] font-semibold text-slate-700">
            <AlertTriangle aria-hidden size={14} className="shrink-0 text-tm-gold-ink" />
            {rows.length} account{rows.length === 1 ? '' : 's'} with no profile. A real signup here
            means something failed at account creation — investigate before backfilling.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Email / mobile</th>
                  <th className="p-3 font-bold">Signup role</th>
                  <th className="p-3 font-bold">Name</th>
                  <th className="p-3 font-bold">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="p-3">
                      <span className="block font-semibold text-tm-navy">{r.email ?? '—'}</span>
                      {r.mobile && <span className="block text-gray-500">{r.mobile}</span>}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.metaRole === '(none)'
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-tm-tint-navy text-tm-navy'
                        }`}
                      >
                        {r.metaRole}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700">{r.fullName ?? '—'}</td>
                    <td className="p-3 text-gray-500">{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
