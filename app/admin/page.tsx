import Link from 'next/link'
import { ArrowRight, BadgeCheck, Briefcase, GraduationCap, Users, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'

import AccessDeniedNotice from '@/components/admin/AccessDeniedNotice'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOverview } from '@/lib/adminOverview'
import { loadFunnel, loadTodo } from '@/lib/adminTodo'
import { TILE_TONE, type TileTone } from '@/lib/tileTones'
import { smsProviderLabel } from '@/lib/sms'

// Each Overview card a distinct colour (PR32 §2) — keyed on the tile's own key,
// so the tones do not drift if the order changes. Five keys, five distinct tones
// (the same shared palette the dashboards use); the icon and the number wear the
// tone, nothing about WHAT each card counts changes.
const TILE_STYLE: Record<string, { tone: TileTone; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }> = {
  revenue: { tone: 'green', icon: Wallet },
  paidThisMonth: { tone: 'teal', icon: BadgeCheck },
  tutors: { tone: 'navy', icon: GraduationCap },
  parents: { tone: 'violet', icon: Users },
  jobs: { tone: 'gold', icon: Briefcase },
}

// The admin landing (redesign, owner 8 Oct 2026): the 5 money/headcount cards,
// then "Today's to-do" — one row per job waiting, with a count and a one-tap
// link, hidden at 0 — then "Signup to payment" for the last 7 or 30 days. The
// Signups-by-role and Revenue-by-plan charts and the "Tutors to nudge" tips were
// removed. Every row is filtered to the screens this role may open.
//
// NO INVENTED DELTAS. The funnel's "% lost" is computed from the same cohort's
// real counts, step to step — never a comparison against another period.

export const dynamic = 'force-dynamic'

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; funnel?: string }>
}) {
  // Overview figures are refused for the restricted tuitions_staff role — this
  // guard redirects it to its own home (/admin/jobs). Full roles pass through.
  const actor = await requireAdminRole(...SCREEN_ACCESS.overview)
  const sp = await searchParams
  const denied = sp.denied === '1'
  const funnelDays: 7 | 30 = sp.funnel === '30' ? 30 : 7

  const [overview, todoAll, funnel] = await Promise.all([loadOverview(), loadTodo(), loadFunnel(funnelDays)])
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
  // The funnel is member data: shown to roles that may open the member directory.
  const seesMembers = may('users')
  // Today's to-do: only rows whose screen this role may open.
  const todo = todoAll.filter((row) => may(row.screen))
  // The SMS/OTP delivery provider (owner PR5b §1.1) — owner and admin only, and
  // only ever the provider NAME, never a credential. `['admin']` admits owner too.
  const seesDelivery = roleSatisfies(actor.adminRole, ['admin'])
  const smsProvider = seesDelivery ? smsProviderLabel() : null

  return (
    <div className="space-y-6">
      {denied && <AccessDeniedNotice />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          Signed in as {actor.email} · role <strong>{actor.adminRole}</strong>
        </p>
        {smsProvider && (
          <p className="text-xs text-gray-500">
            Delivery:{' '}
            <strong className={smsProvider === 'unconfigured' ? 'text-tm-red' : 'text-tm-navy'}>
              {smsProvider}
            </strong>
          </p>
        )}
      </div>

      {tiles.length === 0 ? (
        <div className="space-y-1 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-bold text-tm-navy">Nothing here yet for your role</p>
          <p className="text-xs text-gray-500">
            Ask the owner if you should have access to a screen you cannot see.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => {
            const style = TILE_STYLE[t.key] ?? { tone: 'navy' as TileTone, icon: Wallet }
            const tone = TILE_TONE[style.tone]
            const Icon = style.icon
            return (
              // The whole card is washed in the tone's tint (PR34 §2): a white
              // glyph on the brand-hue chip, and the number, label and meaning
              // in the tone's dark ink shade.
              <Link
                key={t.key}
                href={t.href}
                className={`flex h-full min-h-[104px] flex-col gap-0.5 rounded-2xl border border-black/5 p-4 transition-shadow hover:shadow-md [color-scheme:light] ${tone.card}`}
              >
                <span className={`mb-1 grid h-9 w-9 place-items-center rounded-xl ${tone.chip}`}>
                  <Icon aria-hidden size={18} />
                </span>
                <p className={`text-2xl font-black ${tone.ink}`}>{t.value}</p>
                <p className={`text-[11px] font-bold uppercase tracking-wide ${tone.ink}`}>{t.label}</p>
                <p className={`mt-auto text-[10px] leading-snug opacity-80 ${tone.ink}`}>{t.meaning}</p>
              </Link>
            )
          })}
        </div>
      )}

      {/* ------------------------------------------------------ today's to-do */}
      {todo.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-black text-tm-navy">Today&rsquo;s to-do</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">Each row opens the exact list. Rows with nothing to do are hidden.</p>
          </div>
          <ul>
            {todo.map((row) => (
              <li key={row.key} className="border-b border-gray-200 last:border-0">
                <Link
                  href={row.href}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-tm-bg sm:px-5"
                >
                  <span className="grid h-8 min-w-8 shrink-0 place-items-center rounded-full bg-tm-tint-red px-1.5 text-xs font-black text-tm-red">
                    {row.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-tm-navy">{row.label}</span>
                    {row.detail && <span className="block text-[11px] text-gray-600">{row.detail}</span>}
                  </span>
                  <ArrowRight aria-hidden size={16} className="shrink-0 text-tm-red" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {seesMembers && todo.length === 0 && (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-center text-xs font-bold text-tm-green-deep">
          Nothing waiting on you today.
        </p>
      )}

      {/* --------------------------------------------------- signup to payment */}
      {seesMembers && (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-tm-navy">Signup to payment</h2>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Tutors who signed up in the last {funnelDays} days. Paused and test accounts are left out.
              </p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Period">
              {([7, 30] as const).map((d) => (
                <Link
                  key={d}
                  href={d === 7 ? '/admin' : '/admin?funnel=30'}
                  aria-current={d === funnelDays ? 'page' : undefined}
                  className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-[11px] font-bold ${
                    d === funnelDays ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                  }`}
                >
                  {d} days
                </Link>
              ))}
            </div>
          </div>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {funnel.map((step, i) => (
              <li key={step.label} className="rounded-xl bg-tm-bg p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
                  {i + 1}. {step.label}
                </p>
                <p className="text-2xl font-black text-tm-navy">{step.count}</p>
                {step.lostPct !== null && (
                  <p className={`text-[11px] font-bold ${step.lostPct > 0 ? 'text-tm-red' : 'text-tm-green-deep'}`}>
                    {step.lostPct > 0 ? `${step.lostPct}% lost` : 'None lost'}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
