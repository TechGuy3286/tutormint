import { OVERVIEW_KEY_PEOPLE } from '@/lib/peopleDirectoryCore'
import Link from 'next/link'
import { ArrowRight, BadgeCheck, Briefcase, GraduationCap, UserPlus, Users, Wallet } from 'lucide-react'
import { Fragment, type ComponentType } from 'react'

import AccessDeniedNotice from '@/components/admin/AccessDeniedNotice'
import { requireAdminRole, roleBadge, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOverviewList, type OverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, SIGNUPS_TODAY_HREF, type OverviewItemKey } from '@/lib/overviewItemsCore'
import { chipHref, OVERVIEW_KEY_CHIP } from '@/lib/tutorFollowUpCore'
import { funnelSteps } from '@/lib/staffOutreachCore'
import { TILE_TONE, type TileTone } from '@/lib/tileTones'
import { smsProviderLabel } from '@/lib/sms'
import { pkr } from '@/lib/reconciliationCore'
import { loadSignupFunnel, type FunnelWindowResult } from '@/lib/siteVisits'
import { loadSignupSources } from '@/lib/signupSources'
import type { SourceRow } from '@/lib/signupSourceCore'

// Each Overview card a distinct colour (PR32 §2), keyed on the item key.
// Short card titles (owner, 17 Oct 2026). The list pages keep their own titles.
const TILE_STYLE: Record<string, { tone: TileTone; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; title: string }> = {
  revenue: { tone: 'green', icon: Wallet, title: 'Revenue' },
  'paid-today': { tone: 'teal', icon: BadgeCheck, title: 'Paid' },
  // Signed up today, not paid (owner, 12 Oct 2026): pink — a tone no other card uses.
  'signups-today': { tone: 'pink', icon: UserPlus, title: 'Signed up, not paid' },
  tutors: { tone: 'navy', icon: GraduationCap, title: 'New tutors' },
  parents: { tone: 'violet', icon: Users, title: 'New parents' },
  'open-tuitions': { tone: 'gold', icon: Briefcase, title: 'Tuitions posted' },
}

/** The big number's size: a long figure ("Rs 125,000") steps down so it never
 *  wraps or spills out of a narrow desktop card. */
function bigNumberSize(text: string): string {
  if (text.length > 9) return 'text-lg lg:text-base xl:text-lg'
  if (text.length > 6) return 'text-xl lg:text-lg xl:text-xl'
  return 'text-2xl lg:text-xl xl:text-2xl'
}

const CARD_KEYS: OverviewItemKey[] = ['revenue', 'paid-today', 'tutors', 'parents', 'open-tuitions', 'signups-today']
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
  'todo-email-failed',
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
  // "Signed up today, not paid" opens the existing Unpaid signups list on its
  // Today filter (the same rows), not a second list.
  // The follow-up rows open Follow-ups → Tutors on their chip (owner, 20 Oct 2026).
  const href = (k: OverviewItemKey) =>
    k === 'signups-today' ? SIGNUPS_TODAY_HREF : OVERVIEW_KEY_PEOPLE[k] ? OVERVIEW_KEY_PEOPLE[k] : OVERVIEW_KEY_CHIP[k] ? chipHref(OVERVIEW_KEY_CHIP[k]) : `/admin/overview/${k}${OVERVIEW_ITEMS[k].funnel ? `?days=${funnelDays}` : ''}`

  const tiles = CARD_KEYS.filter((k) => lists.has(k)).map((k) => {
    const l = lists.get(k)!
    return {
      key: k,
      label: TILE_STYLE[k]?.title ?? OVERVIEW_ITEMS[k].title,
      // Square cards (owner, 17 Oct 2026): Today big, then Yesterday, Last 7
      // days and one grey bottom line — no explanations, no arrows. The
      // figures come from the rows the item's loader already reads (one
      // helper, lib/overviewTrendCore); a card without them falls back to its
      // list length.
      card: l.card ?? {
        today: k === 'revenue' ? pkr(l.amount ?? 0) : String(l.rows.length),
        yesterday: '—',
        last7: '—',
        bottom: null,
      },
    }
  })
  const todo = TODO_KEYS.filter((k) => lists.has(k))
    .map((k) => ({ key: k, label: OVERVIEW_ITEMS[k].title, count: lists.get(k)!.rows.length, detail: lists.get(k)!.extra ?? null, note: lists.get(k)!.note ?? null }))
    .filter((r) => r.count > 0)
  const seesMembers = STEP_KEYS.every((k) => lists.has(k))
  // The daily sign-up funnel (owner, 15 Oct 2026): the Owner and the Project
  // Managers only (SCREEN_ACCESS.signupFunnel is []).
  const dailyFunnel = roleSatisfies(actor.adminRole, SCREEN_ACCESS.signupFunnel) ? await loadSignupFunnel() : null
  // Where sign-ups came from (owner, 17 Oct 2026): the same people as the funnel.
  const sources = dailyFunnel ? await loadSignupSources() : null
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => {
            const style = TILE_STYLE[t.key] ?? { tone: 'navy' as TileTone, icon: Wallet }
            const tone = TILE_TONE[style.tone]
            const Icon = style.icon
            return (
              // A square card washed in the tone's tint (PR34 §2): icon and
              // title, Today big, Yesterday and Last 7 days smaller, and one
              // tiny grey bottom line. Nothing wraps: labels truncate, figures
              // never do.
              <Link
                key={t.key}
                href={href(t.key)}
                className={`flex aspect-square min-w-0 flex-col rounded-2xl border border-black/5 p-3 transition-shadow hover:shadow-md [color-scheme:light] ${tone.card}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tone.chip}`}>
                    <Icon aria-hidden size={15} />
                  </span>
                  <span className={`min-w-0 text-[10px] font-bold uppercase leading-tight tracking-wide ${tone.ink}`}>{t.label}</span>
                </span>
                <span className="mt-auto block">
                  <span className="sr-only">Today: </span>
                  <span className={`block whitespace-nowrap font-black tabular-nums leading-tight ${bigNumberSize(t.card.today)} ${tone.ink}`}>
                    {t.card.today}
                  </span>
                </span>
                <span className={`mt-1 flex items-baseline justify-between gap-1 text-[11px] ${tone.ink}`}>
                  <span className="min-w-0 truncate">Yesterday</span>
                  <span className="shrink-0 whitespace-nowrap font-bold tabular-nums">{t.card.yesterday}</span>
                </span>
                <span className={`flex items-baseline justify-between gap-1 text-[10px] ${tone.ink}`}>
                  <span className="min-w-0 truncate">Last 7 days</span>
                  <span className="shrink-0 whitespace-nowrap font-bold tabular-nums">{t.card.last7}</span>
                </span>
                {t.card.bottom && (
                  <span className="mt-1 flex items-baseline justify-between gap-1 text-[9px] text-gray-700">
                    <span className="min-w-0 truncate">{t.card.bottom.label}</span>
                    <span className="shrink-0 whitespace-nowrap font-bold tabular-nums">{t.card.bottom.value}</span>
                  </span>
                )}
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
                {row.note && (
                  <p className="px-4 pt-3 text-[11px] leading-relaxed text-gray-600 sm:px-5">
                    {row.note.before}
                    <span className={row.note.stale ? 'font-bold text-tm-red' : 'font-bold text-slate-700'}>{row.note.date}</span>
                    {row.note.after}{' '}
                    <Link href={row.note.href} className="font-bold text-tm-navy underline-offset-2 hover:underline">
                      {row.note.linkLabel}
                    </Link>
                  </p>
                )}
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

      {/* ------------------------------------------- daily sign-up funnel */}
      {dailyFunnel && <DailySignupFunnel windows={dailyFunnel} />}
      {sources && sources.length > 0 && <SignupSources rows={sources} />}
    </div>
  )
}

/**
 * The daily sign-up funnel (owner, 15 Oct 2026) — the Owner and the Project
 * Managers. Page-visit counts started on 15 Oct 2026, so earlier days read 0.
 */
function DailySignupFunnel({ windows }: { windows: FunnelWindowResult[] }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-black text-tm-navy">Daily sign-up funnel</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Signed-out visits from real browsers (bots and our own crawls are not counted), then real tutor accounts.
          Pakistan time. Visits are counted from 15 Oct 2026.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {windows.map((w) => (
          <div key={w.key} className="space-y-1.5 rounded-xl bg-tm-bg p-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-tm-navy">{w.label}</p>
            <ol className="space-y-1">
              {w.steps.map((s) => (
                <li key={s.key} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-slate-700">{s.label}</span>
                  <span className="shrink-0 text-right">
                    <strong className="text-tm-navy tabular-nums">{s.count}</strong>
                    {s.lostPct !== null && (
                      <span className={`ml-1.5 text-[11px] font-bold ${s.lost ? 'text-tm-red' : 'text-tm-green-deep'}`}>
                        {s.lost ? `−${s.lost} (${s.lostPct}%)` : 'no drop'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-gray-600">Parent sign-up forms: {w.parentSignups}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Where sign-ups came from (owner, 17 Oct 2026) — the first-touch source of
 * every real tutor and parent account created, grouped. "AI assistants" is
 * every AI-assistant site (chatgpt.com, gemini.google.com, perplexity.ai…),
 * with one line per site under it. Pakistan time.
 */
function SignupSources({ rows }: { rows: SourceRow[] }) {
  const cols: { key: keyof SourceRow['counts']; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: 'Last 7 days' },
    { key: 'month', label: 'This month' },
  ]
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-black text-tm-navy">Where sign-ups came from</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          New tutor and parent accounts, by the first link that brought them. Test, staff and paused accounts are left out. Pakistan time.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <thead>
            <tr className="text-left text-[11px] font-black uppercase tracking-wide text-gray-500">
              <th className="py-1.5 pr-2">Source</th>
              {cols.map((c) => (
                <th key={c.key} className="py-1.5 pl-2 text-right">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.group}>
                <tr className="border-t border-gray-100">
                  <td className="py-1.5 pr-2 font-bold text-tm-navy">{r.label}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="py-1.5 pl-2 text-right font-bold tabular-nums text-tm-navy">{r.counts[c.key]}</td>
                  ))}
                </tr>
                {(r.sites ?? []).map((s) => (
                  <tr key={s.site}>
                    <td className="py-1 pl-4 pr-2 text-slate-700">{s.site}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="py-1 pl-2 text-right tabular-nums text-slate-700">{s.counts[c.key]}</td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
