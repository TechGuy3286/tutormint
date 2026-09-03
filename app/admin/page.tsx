import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import RevenueChart from '@/components/admin/charts/RevenueChart'
import SignupsChart from '@/components/admin/charts/SignupsChart'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOverview } from '@/lib/adminOverview'

// The admin landing, as a dashboard rather than a menu.
//
// ONE TILE SYSTEM. Every tile is the same height and reads in the same order —
// the number first, then what it is called, then one line saying what it
// means. A tile whose number represents work waiting carries the gold outline
// the rest of admin already uses for "pending"; a tile that is simply a fact
// about the platform stays quiet. Every one of them links to the screen that
// acts on it, because a number you cannot do anything about is decoration.
//
// NO INVENTED DELTAS. Not a percentage or an arrow anywhere. A comparison
// needs a period that means something, and against seed data every one of them
// would be an artefact.
//
// A role only sees tiles for screens it may open, so a verifier is never shown
// a payments backlog they cannot touch — and never sent to a screen that would
// bounce them straight back here.

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
  const attention = overview.attention.filter((a) => may(a.screen))
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
            Ask the owner if you should have access to a queue you cannot see.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t) => {
            const urgent = (t.pending ?? 0) > 0
            return (
              <Link
                key={t.key}
                href={t.href}
                className={`flex h-full min-h-[104px] flex-col gap-0.5 rounded-2xl border bg-white p-4 transition-colors hover:border-tm-navy ${
                  urgent ? 'border-tm-gold' : 'border-gray-200'
                }`}
              >
                <p className={`text-2xl font-black ${urgent ? 'text-tm-red' : 'text-tm-navy'}`}>
                  {t.value}
                </p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  {t.label}
                </p>
                <p className="mt-auto text-[10px] leading-snug text-gray-500">{t.meaning}</p>
              </Link>
            )
          })}
        </div>
      )}

      {/* --------------------------------------------------- needs attention */}
      <section className="rounded-2xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-500 sm:px-5">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="px-4 py-4 text-xs text-gray-500 sm:px-5">
            Every queue you can work is clear. Nothing is waiting on a decision.
          </p>
        ) : (
          <ul>
            {attention.map((a) => (
              <li key={a.key} className="border-b border-gray-200 last:border-0">
                <Link
                  href={a.href}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-tm-bg sm:px-5"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tm-tint-gold text-xs font-black text-tm-gold-ink">
                    {a.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-tm-navy">{a.headline}</span>
                    <span className="block text-[11px] text-gray-500">{a.detail}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-[11px] font-bold text-tm-red sm:flex">
                    {a.action}
                    <ArrowRight aria-hidden size={13} />
                  </span>
                  <ArrowRight aria-hidden size={16} className="shrink-0 text-tm-red sm:hidden" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------------- the charts */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {may('users') && <SignupsChart data={overview.signups} days={overview.signupDays} />}
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
