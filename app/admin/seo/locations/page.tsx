import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { unmappedLocations } from '@/lib/locationsAdmin'

// /admin/seo/locations — the free-text location review (owner, 11 Sep 2026).
// owner / manager, read-only.
//
// The curated cities and areas are DATA (location_cities / location_areas,
// migration 73), edited by an insert. city/area on jobs, profiles and
// tutor_profiles are plain strings, so a member whose locality is not one of the
// 23 cities types their own — never blocked, never discarded. This lists every
// such free-text value in use, most-used first, so it can be reviewed and
// promoted: promoting one is an insert into the curated table, after which it
// stops appearing here. Computed live from the real columns, so it can never
// miss a write path or go stale.

export const dynamic = 'force-dynamic'

export default async function AdminLocationsPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)

  const rows = await unmappedLocations()
  const cities = rows.filter((r) => r.kind === 'city')
  const areas = rows.filter((r) => r.kind === 'area')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Free-text locations in use</h1>
        <p className="text-xs text-gray-500">
          City and area names members typed that are not in the curated list. Nothing is discarded —
          these are stored on the jobs and profiles that use them. To promote one, add it to{' '}
          <code className="rounded bg-tm-bg px-1">location_cities</code> or{' '}
          <code className="rounded bg-tm-bg px-1">location_areas</code>; it then drops off this list.
        </p>
      </header>

      <Section title={`Cities not in the list (${cities.length})`} rows={cities} showContext={false} />
      <Section title={`Areas not in the list (${areas.length})`} rows={areas} showContext />
    </div>
  )
}

function Section({
  title,
  rows,
  showContext,
}: {
  title: string
  rows: { value: string; cityContext: string | null; count: number }[]
  showContext: boolean
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-black text-tm-navy">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
          Nothing to review — every value in use is curated.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-100 text-gray-500">
              <tr>
                <th className="p-3 font-bold">Value</th>
                {showContext && <th className="p-3 font-bold">Under city</th>}
                <th className="p-3 font-bold">In use</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.value}|${r.cityContext ?? ''}`} className="border-b border-gray-50 last:border-0">
                  <td className="p-3 font-semibold text-tm-navy">{r.value}</td>
                  {showContext && <td className="p-3 text-slate-700">{r.cityContext ?? '—'}</td>}
                  <td className="p-3 text-slate-700">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
