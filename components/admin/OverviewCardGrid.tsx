'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExternalLink, FileCheck2, MessageCircle, Phone, Search } from 'lucide-react'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import { formatDate } from '@/lib/datetime'
import type { BadgeName } from '@/lib/planBadges'
import FollowUpActions, { MarkFollowedUp } from '@/components/admin/FollowUpActions'
import type { FollowUpSource } from '@/lib/followUpCore'
import ProfileShareButtons from '@/components/admin/ProfileShareButtons'
import type { ProfileShare } from '@/lib/profileShareCore'
import { setUrlParam, useUrlState } from '@/lib/useUrlState'
import { adminWhatsAppRoute } from '@/lib/adminWhatsAppCore'
import SelfieMatchWarning from '@/components/admin/SelfieMatchWarning'
import {
  DOC_FILTERS,
  applyDocFilter,
  docFilterCounts,
  docFilterLabel,
  isDocFilter,
  DOC_KIND_TONE,
  withoutJoined,
  type DocFilter,
  type DocSummary,
  showReviewButton,
} from '@/lib/tutorDocSummaryCore'

// The list behind one Overview number, as a grid of cards (owner, 9 Oct 2026):
// 4 per row on desktop, 2 on tablet, 1 on phone. Every row the loader returned
// is a card — "Show more" reveals the rest in steps, so after showing all the
// card count equals the header count (never stops at 1,000). Search narrows the
// cards on this page only and says how many it is showing.

export type GridMember = {
  name: string
  avatarUrl: string | null
  gender?: string | null
  role: 'tutor' | 'parent' | 'other'
  city: string | null
  joinedAt: string | null
  completion: number
  stoppedAt: string | null
  paid: boolean | null
  badges: BadgeName[]
  msisdn: string | null
}

export type GridItem = {
  id: string
  title: string
  detail: string | null
  href: string | null
  amount: string | null
  badge: string | null
  actions: { label: string; href: string }[]
  memberId: string | null
  reviewHref: string | null
  member: GridMember | null
  /** One-tap follow-up (Stuck in onboarding / Follow-up sent). */
  followUp?: {
    source: FollowUpSource
    templateKey: string | null
    waHref: string | null
    telHref: string | null
    tab: 'stuck' | 'sent'
    line: string | null
    tag: string | null
  } | null
  /** Tutors only: the combined Documents status (owner, 19 Oct 2026). */
  docs?: (DocSummary & { oldestUploadAt: string | null; selfieLooksLikePhoto?: boolean }) | null
  /** Tutors only: Copy profile link / Share on WhatsApp (owner, 20 Oct 2026). */
  share?: ProfileShare | null
  /** People tabs (owner, 21 Oct 2026): the value of each extra filter row for
   *  this card, keyed by the row's `param` (e.g. { paid: 'paid' }). */
  tags?: Record<string, string>
  /** Extra text the search box matches (email, mobile) — never shown. */
  searchText?: string
  /** Parents tab: the parent's own facts. */
  parent?: GridParent | null
  /** "Possible duplicate" — the other accounts that look like the same person. */
  dupes?: { id: string; name: string; reason: string }[]
}

export type GridParent = {
  mobileVerified: boolean
  tuitionsOpen: number
  tuitionsTotal: number
  plan: string
  verification: string
  verificationTone: 'good' | 'pending' | 'bad' | 'neutral'
  lastActive: string | null
}

/** An extra single-select chip row above the cards. The first option is the
 *  default; a card matches an option when its tags[param] equals the key ('all'
 *  matches everything). An option with `hideWhenZero` only shows when a card is
 *  in it. Counts are over the cards the search and the rows above leave. */
export type FilterRow = {
  param: string
  label: string
  options: { key: string; label: string; hideWhenZero?: boolean }[]
}

const STEP = 48
const ROLE_WORD = { tutor: 'Tutor', parent: 'Parent', other: 'Member' } as const

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export default function OverviewCardGrid({
  items,
  docFilters = false,
  isOwner = false,
  filterRows = [],
}: {
  items: GridItem[]
  /** Show the Documents filter chips (the Tutors list). */
  docFilters?: boolean
  isOwner?: boolean
  /** Extra chip rows, applied in order before the Documents chips. */
  filterRows?: FilterRow[]
}) {
  const sp = useSearchParams()
  const [sel, setSel] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      filterRows.map((r) => {
        const v = sp.get(r.param)
        return [r.param, v && r.options.some((o) => o.key === v) ? v : r.options[0].key]
      }),
    ),
  )
  const pick = (row: FilterRow, key: string) => {
    setSel((cur) => ({ ...cur, [row.param]: key }))
    setUrlParam(row.param, key === row.options[0].key ? null : key)
  }
  // Search and chip live in the page address (owner, 20 Oct 2026), so coming
  // back from a card — breadcrumb, browser or phone back — reopens the same
  // list. How far 'Show more' went is remembered for the tab.
  const [q, setQ] = useUrlState<string>('q', '')
  const [docFilter, setDocFilter] = useUrlState<DocFilter>('docs', 'all', isDocFilter)
  const [shown, setShownRaw] = useState(STEP)
  useEffect(() => {
    // After the first paint, so the server and browser draw the same first list.
    const frame = requestAnimationFrame(() => {
      try {
        const n = Number(sessionStorage.getItem(`tm:grid-shown:${window.location.pathname}${window.location.search}`))
        if (Number.isFinite(n) && n > STEP) setShownRaw(n)
      } catch {}
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const setShown = (v: number | ((n: number) => number)) =>
    setShownRaw((cur) => {
      const n = typeof v === 'function' ? v(cur) : v
      try {
        sessionStorage.setItem(`tm:grid-shown:${window.location.pathname}${window.location.search}`, String(n))
      } catch {}
      return n
    })
  const router = useRouter()
  // A card followed up from this tab leaves it at once; Undo brings it back.
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const onMoved = (id: string) => {
    setMoved((s) => new Set(s).add(id))
    router.refresh()
  }
  const onRestored = (id: string) => {
    setMoved((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
    router.refresh()
  }

  // Search first, then the Documents chip — the chip counts are over the
  // searched cards, so each count is exactly what that chip shows.
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const pool = items.filter((it) => !(it.memberId && moved.has(it.memberId) && it.followUp?.tab === 'stuck'))
    if (!needle) return pool
    const digits = needle.replace(/\D/g, '')
    return pool.filter(
      (it) =>
        [it.title, it.detail, it.member?.name, it.member?.city, it.badge, it.searchText].some((v) => (v ?? '').toLowerCase().includes(needle)) ||
        (digits.length >= 4 && (it.searchText ?? '').includes(digits)),
    )
  }, [items, q, moved])
  // The extra rows, in order: each row's counts are over what the search and
  // the rows above it leave, so a chip's number is exactly what it shows.
  const { rowCounts, rowed } = useMemo(() => {
    let pool = searched
    const out: Record<string, Record<string, number>> = {}
    for (const row of filterRows) {
      const c: Record<string, number> = {}
      for (const o of row.options) c[o.key] = o.key === 'all' ? pool.length : pool.filter((it) => it.tags?.[row.param] === o.key).length
      out[row.param] = c
      const chosen = sel[row.param] ?? row.options[0].key
      if (chosen !== 'all') pool = pool.filter((it) => it.tags?.[row.param] === chosen)
    }
    return { rowCounts: out, rowed: pool }
  }, [searched, filterRows, sel])
  const counts = useMemo(() => (docFilters ? docFilterCounts(rowed) : null), [docFilters, rowed])
  const filtered = useMemo(() => (docFilters ? applyDocFilter(rowed, docFilter) : rowed), [docFilters, rowed, docFilter])

  const visible = filtered.slice(0, shown)
  const left = filtered.length - visible.length

  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Search this list</span>
        <Search aria-hidden size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(STEP) }}
          placeholder="Search this list"
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-tm-navy"
        />
      </label>
      {filterRows.map((row) => (
        <nav key={row.param} aria-label={row.label} className="flex flex-wrap gap-2">
          {row.options
            .filter((o) => !o.hideWhenZero || (rowCounts[row.param]?.[o.key] ?? 0) > 0 || sel[row.param] === o.key)
            .map((o) => {
              const on = (sel[row.param] ?? row.options[0].key) === o.key
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    pick(row, o.key)
                    setShown(STEP)
                  }}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                    on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                  }`}
                >
                  {o.label} <span className={on ? 'text-white' : 'text-gray-500'}>{rowCounts[row.param]?.[o.key] ?? 0}</span>
                </button>
              )
            })}
        </nav>
      ))}
      {counts && (
        <nav aria-label="Documents" className="flex flex-wrap gap-2">
          {DOC_FILTERS.map((f) => {
            const on = f === docFilter
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => { setDocFilter(f); setShown(STEP) }}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                  on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                }`}
              >
                {docFilterLabel(f, isOwner)} <span className={on ? 'text-white' : 'text-gray-500'}>{counts[f]}</span>
              </button>
            )
          })}
        </nav>
      )}
      {q.trim() && (
        <p className="text-[11px] font-semibold text-gray-600">
          {searched.length} of {items.length} match “{q.trim()}”
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          {items.length === 0 ? 'Nothing here right now.' : searched.length > 0 ? 'No card matches that filter.' : 'No card matches that search.'}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-card-count={filtered.length}>
          {visible.map((it) => (
            <li key={it.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
              {it.member ? <MemberBody it={it} m={it.member} onMoved={onMoved} onRestored={onRestored} /> : <PlainBody it={it} />}
            </li>
          ))}
        </ul>
      )}

      {left > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + STEP)}
          className="mx-auto flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy hover:border-tm-navy"
        >
          Show more ({left} left)
        </button>
      )}
    </div>
  )
}

function MemberBody({
  it,
  m,
  onMoved,
  onRestored,
}: {
  it: GridItem
  m: GridMember
  onMoved: (id: string) => void
  onRestored: (id: string) => void
}) {
  const openHref = `/admin/users/${it.memberId}`
  const fu = it.followUp ?? null
  // The details table already shows the joined date (owner, 19 Oct 2026).
  const memberDetail = withoutJoined(it.detail)
  return (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={m.name} src={m.avatarUrl} gender={m.gender} decorative className="h-12 w-12 shrink-0 text-sm" px={48} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-black text-tm-navy">{m.name}</p>
          {m.badges.length > 0 && <BadgeRow badges={m.badges} size="sm" showUrdu={false} />}
          <p className="text-[11px] text-gray-600">
            {ROLE_WORD[m.role]}
            {m.city ? ` · ${m.city}` : ''}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-gray-500">Joined</dt>
        <dd className="text-right font-semibold text-slate-700">{m.joinedAt ? formatDate(m.joinedAt) : '—'}</dd>
        {it.parent ? (
          <>
            <dt className="text-gray-500">Mobile</dt>
            <dd className={`text-right font-bold ${it.parent.mobileVerified ? 'text-tm-green-deep' : 'text-gray-500'}`}>
              {it.parent.mobileVerified ? 'Verified ✓' : 'Not verified'}
            </dd>
            <dt className="text-gray-500">Tuitions</dt>
            <dd className="text-right font-semibold text-slate-700">
              {it.parent.tuitionsOpen} open / {it.parent.tuitionsTotal} total
            </dd>
            <dt className="text-gray-500">Plan</dt>
            <dd className="text-right font-semibold text-slate-700">{it.parent.plan}</dd>
            <dt className="text-gray-500">Verification</dt>
            <dd className={`text-right font-bold ${PARENT_TONE[it.parent.verificationTone]}`}>{it.parent.verification}</dd>
            <dt className="text-gray-500">Last active</dt>
            <dd className="text-right font-semibold text-slate-700">{it.parent.lastActive ? formatDate(it.parent.lastActive) : '—'}</dd>
          </>
        ) : (
          <>
            <dt className="text-gray-500">Profile</dt>
            <dd className="text-right font-semibold text-slate-700">{m.completion}%</dd>
          </>
        )}
        {m.paid !== null && (
          <>
            <dt className="text-gray-500">Fee</dt>
            <dd className={`text-right font-bold ${m.paid ? 'text-tm-green-deep' : 'text-tm-red'}`}>{m.paid ? 'Paid' : 'Not paid'}</dd>
          </>
        )}
      </dl>

      {it.dupes && it.dupes.length > 0 && (
        <p className="rounded-lg bg-tm-tint-red px-2 py-1 text-[11px] font-semibold text-tm-red">
          Possible duplicate:{' '}
          {it.dupes.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ', ' : ''}
              <Link href={`/admin/users/${d.id}`} className="underline underline-offset-2">
                {d.name}
              </Link>{' '}
              ({d.reason})
            </span>
          ))}
        </p>
      )}
      {it.docs && <DocsRow docs={it.docs} />}
      {it.docs?.selfieLooksLikePhoto && <SelfieMatchWarning compact />}
      {m.role === 'tutor' && it.share && <ProfileShareButtons share={it.share} />}

      {m.stoppedAt && (
        <p className="rounded-lg bg-tm-tint-gold px-2 py-1 text-[11px] font-semibold text-tm-gold-ink">Next: {m.stoppedAt}</p>
      )}
      {memberDetail && <p className="text-[11px] text-gray-600">{memberDetail}</p>}
      {it.badge && (
        <span className="self-start rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">{it.badge}</span>
      )}
      {fu?.tag && (
        <span className="self-start rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">{fu.tag}</span>
      )}
      {fu?.tab === 'sent' && fu.line && (
        <p className="text-[11px] font-semibold text-tm-green-deep">{fu.line}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Link href={openHref} className={`${BTN} bg-tm-navy text-white hover:bg-tm-navy-hover`}>
          <ExternalLink aria-hidden size={13} /> Open
        </Link>
        {fu && it.memberId && (
          <FollowUpActions
            memberId={it.memberId}
            source={fu.source}
            templateKey={fu.templateKey}
            waHref={fu.waHref}
            telHref={fu.telHref}
            tab={fu.tab}
            onMoved={onMoved}
            onRestored={onRestored}
            btnClass={BTN}
          />
        )}
        {!fu && m.msisdn && it.memberId && (
          <a
            // Pre-filled from the member's own state, logged (owner, 20 Oct 2026).
            href={adminWhatsAppRoute(it.memberId, 'overview')}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
          >
            <MessageCircle aria-hidden size={13} /> WhatsApp
          </a>
        )}
        {!fu && m.msisdn && (
          <a href={`tel:+${m.msisdn}`} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
            <Phone aria-hidden size={13} /> Call
          </a>
        )}
        {it.reviewHref && showReviewButton(it.reviewHref, it.docs) && (
          <Link href={it.reviewHref} className={`${BTN} basis-full bg-tm-red text-white hover:bg-tm-red-hover`}>
            <FileCheck2 aria-hidden size={13} /> Review
          </Link>
        )}
      </div>
      {fu && it.memberId && (
        <MarkFollowedUp memberId={it.memberId} source={fu.source} templateKey={fu.templateKey} tab={fu.tab} onMoved={onMoved} onRestored={onRestored} />
      )}
    </>
  )
}

function PlainBody({ it }: { it: GridItem }) {
  return (
    <>
      <div className="min-w-0 space-y-1">
        <p className="break-words text-sm font-black text-tm-navy">{it.title}</p>
        {it.detail && <p className="text-[11px] text-gray-600">{it.detail}</p>}
        {it.amount && <p className="text-xs font-bold text-slate-700">{it.amount}</p>}
        {it.badge && (
          <span className="inline-block rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">{it.badge}</span>
        )}
      </div>
      {(it.href || it.actions.length > 0) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {it.href && (
            <Link href={it.href} className={`${BTN} bg-tm-navy text-white hover:bg-tm-navy-hover`}>
              <ExternalLink aria-hidden size={13} /> Open
            </Link>
          )}
          {it.actions.map((a) => (
            <Link key={a.href} href={a.href} className={`${BTN} border border-gray-200 text-tm-red hover:border-tm-red`}>
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

const DOC_TONE = DOC_KIND_TONE
const PARENT_TONE: Record<GridParent['verificationTone'], string> = {
  good: 'text-tm-green-deep',
  pending: 'text-tm-gold-ink',
  bad: 'text-tm-red',
  neutral: 'text-gray-500',
}

/** The combined Documents status; tap to see each item (owner, 19 Oct 2026). */
function DocsRow({ docs }: { docs: DocSummary }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[11px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[32px] w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-2 text-left hover:border-tm-navy"
      >
        <span className="text-gray-500">Documents</span>
        <span className={`font-bold ${DOC_TONE[docs.kind]}`}>{docs.label}</span>
      </button>
      {open && <p className="mt-1 px-2 font-semibold text-slate-700">{docs.breakdown}</p>}
    </div>
  )
}
