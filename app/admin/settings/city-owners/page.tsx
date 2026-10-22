import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCityOwners } from '@/lib/cityOwners'
import { loadStaffOptions } from '@/lib/applicationTracking'
import CityOwnersClient from './CityOwnersClient'

// Tuitions → City owners (owner, 22 Oct 2026). A tuition no staff member
// posted — a parent's own post — belongs to its city's owner; a city with no
// owner goes to the site Owner. Only the site Owner changes this; the Partner
// sees it read-only. Staff-posted tuitions are never changed.

export const dynamic = 'force-dynamic'

export default async function CityOwnersPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.cityOwners)
  const admin = createAdminClient()
  const [rows, staff, cities] = await Promise.all([
    loadCityOwners(),
    admin ? loadStaffOptions(admin) : Promise.resolve([]),
    admin
      ? admin
          .from('location_cities')
          .select('name')
          .order('sort_order')
          .order('name')
          .then((r) => (r.data ?? []).map((c) => c.name as string))
      : Promise.resolve([] as string[]),
  ])
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">City owners</h2>
        <p className="text-xs text-gray-600">
          Tuitions that no staff member posted (a parent&apos;s own post) belong to the staff member who owns their city. A city with no
          owner goes to the site Owner. Tuitions a staff member posted, and owners chosen by hand on Applications, are never changed.
        </p>
      </header>
      <CityOwnersClient rows={rows} staff={staff} cities={cities} canEdit={actor.adminRole === 'owner'} />
    </div>
  )
}
