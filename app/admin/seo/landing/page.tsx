import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { liveCombinationsAll, LANDING_THRESHOLD } from '@/lib/landing'
import { PREVIEW_MODE } from '@/lib/preview'
import { SITE_URL } from '@/lib/siteUrl'

// /admin/seo/landing — the landing-page monitor. owner / manager, read-only.
//
// Two questions it answers: which city × subject pages are live (and therefore
// in the sitemap), and which sit one tutor / one tuition short of opening — the
// recruiting targets. It reads the same landing_combinations view the public
// pages read, uncached, so an admin sees the true current counts rather than
// whatever the 3-hour cache last served.

export const dynamic = 'force-dynamic'

export default async function AdminLandingSeoPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)

  const all = await liveCombinationsAll()
  const live = all
    .filter((c) => c.count >= LANDING_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
  const near = all
    .filter((c) => c.count === LANDING_THRESHOLD - 1)
    .sort((a, b) => a.kind.localeCompare(b.kind))

  const path = (c: (typeof all)[number]) => `/${c.kind}/${c.citySlug}/${c.subjectSlug}`

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Landing pages</h1>
        <p className="text-xs text-gray-500">
          A page opens at {LANDING_THRESHOLD} listed tutors or open tuitions for a city × subject.
          Below that the URL is a 404 and is left out of the sitemap. Pages revalidate every few
          hours and immediately when a tutor is listed or a tuition opens or closes.
        </p>
        <p className="text-[11px] font-semibold text-tm-gold-ink">
          {PREVIEW_MODE
            ? 'Preview mode is ON — every page is noindex and the sitemap withholds these pages until it is off.'
            : 'Preview mode is OFF — live pages are listed in the sitemap and indexable.'}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">
          Live pages <span className="font-semibold text-gray-500">({live.length})</span>
        </h2>
        {live.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
            No combination has reached the threshold yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Kind</th>
                  <th className="p-3 font-bold">City</th>
                  <th className="p-3 font-bold">Subject</th>
                  <th className="p-3 font-bold">Count</th>
                  <th className="p-3 font-bold">In sitemap</th>
                  <th className="p-3 font-bold">Page</th>
                </tr>
              </thead>
              <tbody>
                {live.map((c) => (
                  <tr key={`${c.kind}:${path(c)}`} className="border-b border-gray-100 last:border-0">
                    <td className="p-3 font-semibold text-tm-navy">{c.kind === 'tutors' ? 'Tutors' : 'Tuitions'}</td>
                    <td className="p-3">{c.city}</td>
                    <td className="p-3">{c.subjectName}</td>
                    <td className="p-3 font-black text-tm-navy">{c.count}</td>
                    <td className="p-3">
                      {PREVIEW_MODE ? (
                        <span className="text-gray-500">held (preview)</span>
                      ) : (
                        <span className="font-semibold text-tm-green-deep">yes</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Link
                        href={path(c)}
                        className="font-semibold text-tm-red hover:underline"
                        target="_blank"
                      >
                        {path(c)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">
          One short of opening{' '}
          <span className="font-semibold text-gray-500">({near.length})</span>
        </h2>
        <p className="text-[11px] text-gray-500">
          These have {LANDING_THRESHOLD - 1}. Recruiting one more {`{tutor / tuition}`} opens a page —
          where onboarding effort turns directly into an indexable page.
        </p>
        {near.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
            Nothing is sitting just under the threshold.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Kind</th>
                  <th className="p-3 font-bold">City</th>
                  <th className="p-3 font-bold">Subject</th>
                  <th className="p-3 font-bold">Have</th>
                  <th className="p-3 font-bold">Would be</th>
                </tr>
              </thead>
              <tbody>
                {near.map((c) => (
                  <tr key={`near:${c.kind}:${path(c)}`} className="border-b border-gray-100 last:border-0">
                    <td className="p-3 font-semibold text-tm-navy">{c.kind === 'tutors' ? 'Tutors' : 'Tuitions'}</td>
                    <td className="p-3">{c.city}</td>
                    <td className="p-3">{c.subjectName}</td>
                    <td className="p-3 font-black text-tm-navy">{c.count}</td>
                    <td className="p-3 text-gray-500">{SITE_URL}{path(c)}</td>
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
