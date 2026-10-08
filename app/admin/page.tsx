import Link from 'next/link'
import { ArrowRight, BadgeCheck, Briefcase, GraduationCap, Users, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'

import AccessDeniedNotice from '@/components/admin/AccessDeniedNotice'
import { requireAdminRole, roleBadge, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOverviewList, type OverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, type OverviewItemKey } from '@/lib/overviewItemsCore'
import { funnelSteps } from '@/lib/staffOutreachCore'
import { TILE_TONE, type TileTone } from '@/lib/tileTones'
import { smsProviderLabel } from '@/lib/sms'
import { pkr } from '@/lib/reconciliationCore'

// Each Overview card a distinct colour (PR32 §2), keyed on the item key.
const TILE_STYLE: Record<string, { tone: TileTone; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; meaning: string }> = {
  revenue: { tone: 'green', icon: Wallet, meaning: 'Approved this month, not refunded' },
  'paid-today': { tone: 'teal', icon: BadgeCheck, meaning: '' },
  tutors: { tone: 'navy', icon: GraduationCap, meaning: 'Registered accounts' },
  parents: { tone: 'violet', icon: Users, meaning: 'Registered accounts' },
  'open-tuitions': { tone: 'gold', icon: Briefcase, meaning: 'Live on the board for tutors to apply to' },
}

const CARD_KEYS: OverviewItemKey[] = ['revenue', 'paid-today', 'tutors', 'parents', 'open-tuitions']
const TODO_KEYS: OverviewItemKey[] = [
  'todo-docs',
  'todo-uncontacted',
  'todo-stuck',
  'todo-payments',
  'todo-due',
  'todo-flagged',
  'todo-pausing',
  'todo-featured',
  'todo-unmet',
]
const STEP_KEYS: OverviewItemKey[] = ['funnel-signed-up', 'funnel-mobile', 'funnel-onboarded', 'funnel-paid']
const LOST_KEYS: (OverviewItemKey | null)[] = [null, 'lost-mobile', 'lost-onboarding', 'lost-payment']

// The admin landing (owner, 8 Oct 2026). COUNTS MATCH THEIR LISTS: every card,
// to-do row and funnel step (and each "lost" figure) is one item of
// lib/overviewItems — the number shown is the length of that item's list (the
// revenue card, its sum), and clicking it opens /admin/overview/<key>, which
// renders the same rows. Every item is filtered to the screens this role may
// open (OVERVIEW_ITEMS[key].screen), and a role never loads an item it cannot
// see. Revenue is owner-only (plus the view-only Partner).

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

  const may = (key: OverviewItemKey) => roleSatisfies(actor.adminRole, SCREEN_ACCESS[OVERVIEW_ITEMS[key].screen])
  const keys = [...CARD_KEYS, ...TODO_KEYS, ...STEP_KEYS, ...(LOST_KEYS.filter(Boolean) as OverviewItemKey[])].filter(may)
  const lists = new Map<OverviewItemKey, OverviewList>(
    await Promise.all(keys.map(async (k) => [k, await loadOverviewList(k, { days: funnelDays })] as const)),
  )
  const href = (k: OverviewItemKey) =>
    `/admin/overview/${k}${OVERVIEW_ITEMS[k].funnel ? `?days=${funnelDays}` : ''}`

  const tiles = CARD_KEYS.filter((k) => lists.has(k)).map((k) => {
    const l = lists.get(k)!
    return {
      key: k,
      label: OVERVIEW_ITEMS[k].title,
      value: k === 'revenue' ? pkr(l.amount ?? 0) : String(l.rows.length),
      meaning: l.extra ?? TILE_STYLE[k]?.meaning ?? '',
    }
  })
  const todo = TODO_KEYS.filter((k) => lists.has(k))
    .map((k) => ({ key: k, label: OVERVIEW_ITEMS[k].title, count: lists.get(k)!.rows.length, detail: lists.get(k)!.extra ?? null }))
    .filter((r) => r.count > 0)
  const seesMembers = STEP_KEYS.every((k) => lists.has(k))
  const counts = STEP_KEYS.map((k) => lists.get(k)?.rows.length ?? 0)
  const funnel = funnelSteps(counts, STEP_KEYS.map((k) => OVERVIEW_ITEMS[k].title))

  // The SMS/OTP delivery provider (owner PR5b §1.1) — owner, Partner and admin,
  // and only ever the provider NAME, never a credential.
  const seesDelivery = roleSatisfies(actor.adminRole, ['admin'])
  const smsProvider = seesDelivery ? smsProviderLabel() : null

  return (
    <div className="space-y-6">
      {denied && <AccessDeniedNotice />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          Signed in as {actor.email} · role <strong>{roleBadge(actor.adminRole)}</strong>
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
                href={href(t.key)}
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
            <p className="mt-0.5 text-[11px] text-gray-500">Each number opens exactly that list. Rows with nothing to do are hidden.</p>
          </div>
          <ul>
            {todo.map((row) => (
              <li key={row.key} className="border-b border-gray-200 last:border-0">
                <Link
                  href={href(row.key)}
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
                Tutors who signed up in the last {funnelDays} days. Paused, test and staff accounts are left out.
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
            {funnel.map((step, i) => {
              const lost = LOST_KEYS[i]
              const lostCount = lost ? (lists.get(lost)?.rows.length ?? 0) : 0
              return (
                <li key={step.label} className="rounded-xl bg-tm-bg p-3">
                  <Link href={href(STEP_KEYS[i])} className="block hover:underline">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
                      {i + 1}. {step.label}
                    </p>
                    <p className="text-2xl font-black text-tm-navy">{step.count}</p>
                  </Link>
                  {lost && step.lostPct !== null && (
                    <Link
                      href={href(lost)}
                      className={`text-[11px] font-bold hover:underline ${lostCount > 0 ? 'text-tm-red' : 'text-tm-green-deep'}`}
                    >
                      {lostCount > 0 ? `${lostCount} lost (${step.lostPct}%)` : 'None lost'}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
