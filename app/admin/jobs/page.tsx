import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { adminJobFacets, adminJobPage, type AdminJobFilters } from '@/lib/adminJobs'

import JobFilters from './JobFilters'
import JobRow from './JobRow'
import MoreJobs from './MoreJobs'

// Every tuition on the platform, as staff.
//
// It did not exist. Admin could see tutors, parents, payments, reports and
// members, and had no way at all to look at a job -- which is the object every
// one of those screens is ultimately about. "Why has nobody applied to my
// tuition" could not be answered without a database client.
//
// Unlike /browse/tuitions this shows CLOSED and HIRED jobs, and jobs posted by
// suspended parents. Those are the ones somebody opens this screen to find.
//
// The filters are a plain GET, so a filtered list is a URL an admin can send a
// colleague, and the back button behaves.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 40

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; city?: string; subject?: string; featured?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.jobs)

  const sp = await searchParams
  const filters: AdminJobFilters = {
    q: sp.q ?? '',
    status: sp.status ?? '',
    city: sp.city ?? '',
    subject: sp.subject ?? '',
    featured: sp.featured ?? '',
  }

  const [{ rows, nextCursor, total }, facets] = await Promise.all([
    adminJobPage({ filters, limit: PAGE_SIZE }),
    adminJobFacets(),
  ])

  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(filters)) if (v) params[k] = v

  const filtered = Object.keys(params).length > 0

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-xs text-gray-500">
          {total} {total === 1 ? 'tuition' : 'tuitions'}
          {filtered ? ' matching these filters' : ' posted on TutorMint'}.
        </p>
      </header>

      <JobFilters values={filters} cities={facets.cities} subjects={facets.subjects} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          {filtered
            ? 'No tuitions match those filters. Clear one and try again.'
            : 'No tuitions have been posted yet.'}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((r) => (
              <JobRow key={r.id} row={r} />
            ))}
          </ul>
          <MoreJobs
            params={params}
            initialCursor={nextCursor}
            serverCount={rows.length}
            total={total}
          />
        </>
      )}
    </div>
  )
}
