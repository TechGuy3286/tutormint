import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { unmappedLocations } from '@/lib/locationsAdmin'
import { curatedAreasForCities, loadLocationReviewPage } from '@/lib/locationReview'

import LocationsReviewClient from './LocationsReviewClient'
import StaffAddedAreas from './StaffAddedAreas'
import { loadStaffAddedAreas, staffAreaSuggestions } from '@/lib/staffAreas'
import { addedByLine } from '@/lib/staffAreaCore'
import { formatDate } from '@/lib/datetime'
import Link from 'next/link'
import AutoMerges from './AutoMerges'
import { loadAutoMerges } from '@/lib/locationAutoMerge'

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
//
// 16 Oct 2026: two sections — "Staff-added areas" and "Typed by tutors and
// parents". The typed list loads a page at a time from /api/admin/locations
// (suggestions computed on the server), and bulk approval is one kind at a
// time, confirmed, in small batches. Approving is the Owner's on the server.

export const dynamic = 'force-dynamic'

export default async function AdminLocationsPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)

  const [first, unmapped, added, suggestions, autoMerges] = await Promise.all([
    loadLocationReviewPage({ kind: 'all', limit: 1 }),
    unmappedLocations(),
    loadStaffAddedAreas(),
    staffAreaSuggestions(),
    loadAutoMerges(),
  ])
  const staffCities = await curatedAreasForCities(added.map((a) => a.city))
  const counts = first.counts
  const cities = unmapped.filter((r) => r.kind === 'city')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Free-text locations in use</h1>
        <p className="text-xs text-gray-600">
          Check each suggestion, then approve it or change it. The text on tuitions and profiles is never changed, and nothing is deleted.
        </p>
        <p className="text-xs">
          <Link href="/admin/seo/locations/added" className="font-bold text-tm-red hover:underline">
            Review added areas (the 16 Oct bulk approval) →
          </Link>
        </p>
      </header>

      {/* The clean-up's automatic merges, each with an Undo (owner, 28 Oct 2026). */}
      <AutoMerges items={autoMerges.map((m) => ({ auditId: m.auditId, atText: formatDate(m.at), record: m.record, undone: !!m.undoneAt }))} />

      {/* Areas staff added while posting a tuition (owner, 13 + 16 Oct 2026). */}
      <StaffAddedAreas
        areas={added.map((a) => ({ id: a.id, name: a.name, city: a.city, line: addedByLine(a.addedBy, a.addedAt ? formatDate(a.addedAt) : null) }))}
        areasByCity={staffCities}
        suggestions={suggestions}
      />

      {/* The heading and the counts live in the client: one fresh count for all. */}
      <section className="space-y-2">
        <LocationsReviewClient initialCounts={counts} />
      </section>

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
