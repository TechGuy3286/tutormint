'use client'

import type { ReactNode } from 'react'
import { TILE_TONE } from '@/lib/tileTones'
import {
  URDU_FONT,
  STATUS_META,
  SECTIONS,
  CARDS,
  type CardStatus,
} from '@/lib/tutorSettingsCopy'

// Presentational pieces for the tutor Settings redesign (PR62). No hooks, no data
// — the page owns all state and every form body; these draw the shell around
// them: the step headers with counts, the per-card status card (green / red /
// waiting / rejected) with English + Urdu, and the tinted tile used in tile mode.

// Every Urdu line is a full-width, right-aligned block (owner PR63 §C3) — flush
// to the card's right edge, never squeezed beside an English element.
export function Urdu({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span lang="ur" dir="rtl" className={`block w-full text-right ${className}`} style={{ fontFamily: URDU_FONT }}>
      {children}
    </span>
  )
}

function fill(t: string, done: number, total: number) {
  return t.replace('{done}', String(done)).replace('{total}', String(total))
}

export function StepHeader({
  section,
  done,
  total,
}: {
  section: 'step1' | 'step2' | 'account'
  done?: number
  total?: number
}) {
  const s = SECTIONS[section]
  const hasCount = s.count && typeof done === 'number' && typeof total === 'number'
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-black text-tm-navy">{s.title.en}</h2>
        {hasCount && (
          <span className="shrink-0 text-[11px] font-black text-tm-green-deep">
            {fill(s.count!.en, done!, total!)}
          </span>
        )}
      </div>
      {/* Urdu heading and count each on their own full-width right-aligned line. */}
      <Urdu className="text-sm font-bold text-tm-navy">{s.title.ur}</Urdu>
      {hasCount && (
        <Urdu className="text-[11px] font-bold text-tm-green-deep">{fill(s.count!.ur, done!, total!)}</Urdu>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: CardStatus }) {
  const meta = STATUS_META[status]
  if (!meta.badge) return null
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-black ${meta.badgeCls}`}>
      {meta.badge.en}
    </span>
  )
}

// One card: its title (English + Urdu, each Urdu line flush right, full width),
// the status badge, an optional reject reason, and then either the page's form
// body or — once the card has a saved value — a plain-text summary with a small
// Edit button (owner PR63 §C2). Collapse only applies when `summary` and `onEdit`
// are provided and the card is not `open`; other cards always show their body.
export function StatusCard({
  cardKey,
  status,
  reason,
  bare = false,
  summary,
  open = true,
  onEdit,
  children,
}: {
  cardKey: string
  status: CardStatus
  reason?: string | null
  /** The child is already a self-contained card (CNIC, email, a read-only line),
   *  so it is rendered without the inner white box. */
  bare?: boolean
  /** The collapsed plain-text value, e.g. "Lahore · Model Town". */
  summary?: string | null
  /** Whether the form body is shown. Ignored unless the card is collapsible. */
  open?: boolean
  /** Tapping Edit; presence of this + a non-empty summary makes the card collapsible. */
  onEdit?: () => void
  children: ReactNode
}) {
  const meta = STATUS_META[status]
  const copy = CARDS[cardKey]
  const badge = STATUS_META[status].badge
  const collapsible = !!onEdit && !!summary && summary.trim() !== ''
  const showBody = !collapsible || open

  return (
    <section className={`space-y-2 rounded-2xl border p-4 sm:p-5 ${meta.card}`}>
      {/* English title + badge on one row; the Urdu title and Urdu badge each on
          their own full-width right-aligned line below. */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-black text-tm-navy">{copy.title.en}</h3>
        <StatusBadge status={status} />
      </div>
      <Urdu className="text-[13px] font-bold text-tm-navy">{copy.title.ur}</Urdu>
      {badge && <Urdu className="text-[10px] font-bold text-gray-600">{badge.ur}</Urdu>}
      {copy.hint && (
        <>
          <p className="text-[11px] leading-relaxed text-gray-600">{copy.hint.en}</p>
          <Urdu className="text-[11px] leading-relaxed text-gray-600">{copy.hint.ur}</Urdu>
        </>
      )}

      {status === 'rejected' && reason && (
        <p className="rounded-xl bg-white/70 p-2.5 text-[11px] font-semibold text-tm-red">{reason}</p>
      )}

      {showBody ? (
        <div className="pt-1">
          {bare ? children : <div className="rounded-xl bg-white p-3 sm:p-4">{children}</div>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-tm-navy">{summary}</p>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-tm-navy/30 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:bg-tm-tint-navy"
          >
            Edit
          </button>
        </div>
      )}
    </section>
  )
}

// A tinted tile (tile mode): the same square-tile look as the dashboard, tinted
// by the card's status, tap to open that card's form.
export function SettingsTile({
  cardKey,
  status,
  icon,
  open,
  onClick,
}: {
  cardKey: string
  status: CardStatus
  icon: ReactNode
  open: boolean
  onClick: () => void
}) {
  const tone = TILE_TONE[STATUS_META[status].tone]
  const copy = CARDS[cardKey]
  const badge = STATUS_META[status].badge
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`flex min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition-shadow hover:shadow-md ${tone.card} ${
        open ? 'border-tm-navy ring-2 ring-tm-navy/30' : 'border-black/5 shadow-xs'
      }`}
    >
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${tone.chip}`}>{icon}</span>
      <span className={`text-xs font-black leading-tight ${tone.ink}`}>{copy.title.en}</span>
      <Urdu className={`text-[11px] font-bold ${tone.ink}`}>{copy.title.ur}</Urdu>
      {badge && <span className={`text-[10px] font-black ${tone.ink}`}>{badge.en}</span>}
    </button>
  )
}
