import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import RevenueChart from '@/components/admin/charts/RevenueChart'
import SignupsChart from '@/components/admin/charts/SignupsChart'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOverview } from '@/lib/adminOverview'

// The admin landing: how much the platform is earning, and who to nudge onto a
// plan (owner, 14 Sep 2026). The queue tiles and the "Needs attention" block
// were removed — each queue has its own screen and its own count. The tiles are
// money and headcount; the Tips block is real, clickable conversion worklists.
//
// NO INVENTED DELTAS. Not a percentage or an arrow anywhere — against seed data
// a comparison would be an artefact. A role only sees tiles/tips for screens it
// may open.

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  const actor = await getAdminActor()
  if (!actor) return null // the layout has already redirected

  const overview = await loadOverview()
  if (!overview) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so the dashboard cannot be
        loaded.
      </p>
    )
  }

  const may = (screen?: keyof typeof SCREEN_ACCESS) =>
    !screen || roleSatisfies(actor.adminRole, SCREEN_ACCESS[screen])

  const tiles = overview.tiles.filter((t) => may(t.screen))
  // Tips are the conversion worklists (member lists + the signups page). A role
  // that cannot open the member directory is not shown them.
  const seesMembers = may('users')
  const seesMoney = may('payments')

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">
        Signed in as {actor.email} · role <strong>{actor.adminRole}</strong>
      </p>

      {tiles.length === 0 ? (
        <div className="space-y-1 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-bold text-tm-navy">Nothing here yet for your role</p>
          <p className="text-xs text-gray-500">
            Ask the owner if you should have access to a screen you cannot see.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="flex h-full min-h-[104px] flex-col gap-0.5 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-tm-navy"
            >
              <p className="text-2xl font-black text-tm-navy">{t.value}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{t.label}</p>
              <p className="mt-auto text-[10px] leading-snug text-gray-500">{t.meaning}</p>
            </Link>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------- tips */}
      {seesMembers && (
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Tips</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Tutors to nudge onto a plan. Each row opens the exact list.
            </p>
          </div>
          <ul>
            {overview.tips.map((tip) => (
              <li key={tip.key} className="border-b border-gray-200 last:border-0">
                <Link
                  href={tip.href}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-tm-bg sm:px-5"
                >
                  <span
                    className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-full px-1.5 text-xs font-black ${
                      tip.count > 0 ? 'bg-tm-tint-navy text-tm-navy' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {tip.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-tm-navy">{tip.label}</span>
                    <span className="block text-[11px] text-gray-500">{tip.meaning}</span>
                  </span>
                  <ArrowRight aria-hidden size={16} className="shrink-0 text-tm-red" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------------- the charts */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {seesMembers && <SignupsChart data={overview.signups} days={overview.signupDays} />}
        {seesMoney && (
          <RevenueChart
            data={overview.revenue}
            period={overview.revenuePeriod}
            total={overview.revenueTotal}
          />
        )}
      </div>
    </div>
  )
}
