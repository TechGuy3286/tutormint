'use client'

import type { ReactNode } from 'react'
import { Lock, MessageCircle, X } from 'lucide-react'
import { TILE_TONE, TILE_BOX, TILE_CHIP, TILE_BORDER_DEFAULT, TILE_BORDER_OPEN } from '@/lib/tileTones'
import { supportWhatsappHref } from '@/lib/errorMessages'
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

// Every Urdu line is a full-width block (owner PR63 §C3). It is right-aligned by
// default — flush to a card's right edge, never squeezed beside an English
// element — but CENTRED inside a tile (PR78 §A.1), where the English name above
// it is centred and a right-aligned Urdu line looked misaligned. dir="rtl" holds
// either way.
export function Urdu({
  children,
  className = '',
  center = false,
}: {
  children: ReactNode
  className?: string
  center?: boolean
}) {
  return (
    <span
      lang="ur"
      dir="rtl"
      className={`block w-full ${center ? 'text-center' : 'text-right'} ${className}`}
      style={{ fontFamily: URDU_FONT }}
    >
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
      {/* Urdu heading and count each on their own full-width right-aligned line.
          tm-ur-cap keeps them no larger than the English above (PR77 §4). */}
      <Urdu className="tm-ur-cap text-sm font-bold text-tm-navy">{s.title.ur}</Urdu>
      {hasCount && (
        <Urdu className="tm-ur-cap text-[11px] font-bold text-tm-green-deep">{fill(s.count!.ur, done!, total!)}</Urdu>
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
  onClose,
  locked = false,
  lockedValue,
  lockedNote,
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
  /** PR77: when this card is the EXPANDED tile, a × in the header collapses it
   *  without saving. */
  onClose?: () => void
  /** PR72 §E: the field is locked — read-only, a lock icon, no Edit, a
   *  "contact support" note. `lockedValue` is the value shown read-only. */
  locked?: boolean
  lockedValue?: string | null
  /** Replaces the default "contact support" block under a locked value (the
   *  approved-document lock notice, owner 9 Oct 2026). */
  lockedNote?: ReactNode
  children: ReactNode
}) {
  const meta = STATUS_META[status]
  const copy = CARDS[cardKey]
  const badge = STATUS_META[status].badge
  const collapsible = !locked && !!onEdit && !!summary && summary.trim() !== ''
  const showBody = !collapsible || open

  return (
    <section className={`space-y-2 rounded-2xl border p-4 sm:p-5 ${meta.card}`}>
      {/* English title + badge on one row; the Urdu title and Urdu badge each on
          their own full-width right-aligned line below. */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
          {locked && <Lock aria-hidden size={13} className="shrink-0 text-gray-500" />}
          {copy.title.en}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={status} />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close without saving"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100"
            >
              <X aria-hidden size={15} />
            </button>
          )}
        </div>
      </div>
      <Urdu className="tm-ur-cap text-sm font-bold text-tm-navy">{copy.title.ur}</Urdu>
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

      {locked ? (
        // PR72 §E: read-only value + a lock icon (in the title) + a "contact
        // support" note in English and Urdu with the WhatsApp link. No Edit.
        <div className="space-y-2 pt-1">
          {lockedValue && lockedValue.trim() !== '' && (
            <p className="rounded-xl bg-white p-3 text-xs font-semibold text-tm-navy">{lockedValue}</p>
          )}
          {lockedNote ?? (<>
          <p className="text-[11px] leading-relaxed text-gray-600">To change this, contact support.</p>
          <Urdu className="text-[11px] leading-relaxed text-gray-600">تبدیلی کے لیے سپورٹ سے رابطہ کریں۔</Urdu>
          <a
            href={supportWhatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-tm-navy/30 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:bg-tm-tint-navy"
          >
            <MessageCircle aria-hidden size={13} /> WhatsApp 0321 5872222
          </a>
          </>)}
        </div>
      ) : showBody ? (
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

// A tinted tile — the EXACT dashboard tile shell (PR77): the same box, icon chip,
// grid and font sizes as StatTile (all from lib/tileTones), tinted by the card's
// STATUS (green completed, red missing, navy waiting…). Inside: the icon, the
// English name, the Urdu name and the status word (or a lock icon when locked).
// Tap to expand that card in place. `title`/`titleUr` may be passed explicitly so
// the same tile serves parent Settings (which has no CARDS copy).
export function SettingsTile({
  cardKey,
  status,
  icon,
  open,
  onClick,
  title,
  titleUr,
  locked = false,
}: {
  cardKey?: string
  status: CardStatus
  icon: ReactNode
  open: boolean
  onClick: () => void
  title?: string
  titleUr?: string
  locked?: boolean
}) {
  const tone = TILE_TONE[STATUS_META[status].tone]
  const copy = cardKey ? CARDS[cardKey] : undefined
  const en = title ?? copy?.title.en ?? ''
  const ur = titleUr ?? copy?.title.ur ?? ''
  const badge = STATUS_META[status].badge
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`${TILE_BOX} ${tone.card} ${open ? TILE_BORDER_OPEN : TILE_BORDER_DEFAULT}`}
    >
      <span className={`${TILE_CHIP} ${tone.chip}`}>{icon}</span>
      <span className={`line-clamp-2 text-xs font-semibold leading-snug ${tone.ink}`}>{en}</span>
      {/* The Urdu tile name matches the English one's size (PR83 Part A.1):
          tm-ur-cap opts out of the +18% body bump, so it sits at text-xs like
          the English above it instead of wrapping larger. */}
      <Urdu center className={`tm-ur-cap text-xs font-bold ${tone.ink}`}>{ur}</Urdu>
      <span className={`inline-flex items-center gap-1 text-[10px] font-black ${tone.ink}`}>
        {locked && <Lock aria-hidden size={11} />}
        {locked ? 'Locked' : badge?.en}
      </span>
    </button>
  )
}

// The header row of an EXPANDED tile (PR77): the title (English + Urdu), the
// status badge, and a × to collapse without saving. Shared by tutor and parent
// Settings so an open tile looks the same on both.
export function OpenTileHeader({
  title,
  titleUr,
  status,
  onClose,
}: {
  title: string
  titleUr: string
  status: CardStatus
  onClose: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-black text-tm-navy">{title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={status} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without saving"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X aria-hidden size={15} />
          </button>
        </div>
      </div>
      {titleUr && <Urdu className="tm-ur-cap text-sm font-bold text-tm-navy">{titleUr}</Urdu>}
    </div>
  )
}
