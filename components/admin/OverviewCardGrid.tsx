'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, FileCheck2, MessageCircle, Phone, Search } from 'lucide-react'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import { formatDate } from '@/lib/datetime'
import type { BadgeName } from '@/lib/planBadges'
import FollowUpActions, { MarkFollowedUp } from '@/components/admin/FollowUpActions'
import type { FollowUpSource } from '@/lib/followUpCore'

// The list behind one Overview number, as a grid of cards (owner, 9 Oct 2026):
// 4 per row on desktop, 2 on tablet, 1 on phone. Every row the loader returned
// is a card — "Show more" reveals the rest in steps, so after showing all the
// card count equals the header count (never stops at 1,000). Search narrows the
// cards on this page only and says how many it is showing.

export type GridMember = {
  name: string
  avatarUrl: string | null
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
}

const STEP = 48
const ROLE_WORD = { tutor: 'Tutor', parent: 'Parent', other: 'Member' } as const

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export default function OverviewCardGrid({ items }: { items: GridItem[] }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(STEP)
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const pool = items.filter((it) => !(it.memberId && moved.has(it.memberId) && it.followUp?.tab === 'stuck'))
    if (!needle) return pool
    return pool.filter((it) =>
      [it.title, it.detail, it.member?.name, it.member?.city, it.badge].some((v) => (v ?? '').toLowerCase().includes(needle)),
    )
  }, [items, q, moved])

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
      {q.trim() && (
        <p className="text-[11px] font-semibold text-gray-600">
          {filtered.length} of {items.length} match “{q.trim()}”
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          {items.length === 0 ? 'Nothing here right now.' : 'No card matches that search.'}
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
  return (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={m.name} src={m.avatarUrl} seed={it.memberId} decorative className="h-12 w-12 shrink-0 text-sm" px={48} />
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
        <dt className="text-gray-500">Profile</dt>
        <dd className="text-right font-semibold text-slate-700">{m.completion}%</dd>
        {m.paid !== null && (
          <>
            <dt className="text-gray-500">Fee</dt>
            <dd className={`text-right font-bold ${m.paid ? 'text-tm-green-deep' : 'text-tm-red'}`}>{m.paid ? 'Paid' : 'Not paid'}</dd>
          </>
        )}
      </dl>

      {m.stoppedAt && (
        <p className="rounded-lg bg-tm-tint-gold px-2 py-1 text-[11px] font-semibold text-tm-gold-ink">Stopped at: {m.stoppedAt}</p>
      )}
      {it.detail && <p className="text-[11px] text-gray-600">{it.detail}</p>}
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
        {!fu && m.msisdn && (
          <a
            href={`https://wa.me/${m.msisdn}`}
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
        {it.reviewHref && (
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
