import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { unmappedLocations } from '@/lib/locationsAdmin'
import { loadLocationReview } from '@/lib/locationReview'

import LocationsReviewClient from './LocationsReviewClient'
import StaffAddedAreas from './StaffAddedAreas'
import { loadStaffAddedAreas, staffAreaSuggestions } from '@/lib/staffAreas'
import { addedByLine } from '@/lib/staffAreaCore'
import { formatDate } from '@/lib/datetime'

// /admin/seo/locations — the free-text location review.
//
// The curated cities and areas are DATA (location_cities / location_areas).
// city/area on tuitions and profiles are plain text, so a member whose locality
// is not listed types their own — never blocked, never discarded.
//
// Since 13 Oct 2026 every typed AREA here has a suggested action and three
// buttons — "Add as new area", "Same as existing area", "Not an area" — and
// rows can be approved together. Approving never rewrites the text a member
// saved; it only records what that text means (lib/locationReview). Typed
// CITIES stay a plain list for review.

export const dynamic = 'force-dynamic'

export default async function AdminLocationsPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)

  const [board, unmapped, added, suggestions] = await Promise.all([loadLocationReview(), unmappedLocations(), loadStaffAddedAreas(), staffAreaSuggestions()])
  const cities = unmapped.filter((r) => r.kind === 'city')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Free-text locations in use</h1>
        <p className="text-xs text-gray-600">
          {board.rows.length} typed area{board.rows.length === 1 ? '' : 's'} to review. Each has a suggestion — check it, then approve it or
          choose another button. The text on tuitions and profiles is never changed, and nothing is deleted.
        </p>
        <p className="text-[11px] text-gray-600">
          Suggested: {board.counts.same} same as an area · {board.counts.notArea} not an area · {board.counts.add} new area. Already
          done: {board.counts.aliases} counted as an existing area · {board.counts.ignored} marked not an area.
        </p>
      </header>

      <LocationsReviewClient rows={board.rows} areasByCity={board.areasByCity} />

      {/* Areas staff added while posting a tuition (owner, 13 Oct 2026). */}
      <StaffAddedAreas
        areas={added.map((a) => ({ id: a.id, name: a.name, city: a.city, line: addedByLine(a.addedBy, a.addedAt ? formatDate(a.addedAt) : null) }))}
        areasByCity={board.areasByCity}
        suggestions={suggestions}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Cities not in the list ({cities.length})</h2>
        {cities.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Every city in use is in the list.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 text-gray-600">
                <tr>
                  <th className="p-3 font-bold">City as typed</th>
                  <th className="p-3 font-bold">In use</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((r) => (
                  <tr key={r.value} className="border-b border-gray-50 last:border-0">
                    <td className="p-3 font-semibold text-tm-navy">{r.value}</td>
                    <td className="p-3 text-slate-700">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
