'use client'

import { submitSignal } from '@/lib/submit'

import { Bell, Loader2 } from 'lucide-react'
import TimeAgo from '@/components/TimeAgo'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import type { NotificationRow } from '@/lib/notificationFeed'

// The header bell.
//
// The unread count is rendered by the SERVER on first paint, the same decision
// the header itself made: a badge that appears a beat after the page has
// settled reads as a notification that just arrived, and it makes people look
// twice at something that was already there.
//
// Opening the panel fetches the recent items and then marks READ ONLY THE ONES
// IT SHOWED. "Mark everything read on open" is the obvious implementation and
// it loses things: a notification that lands while the panel is open, and is
// never on screen, would be cleared unseen — and the one most likely to arrive
// at a busy moment is the one saying somebody hired you.

// How many the panel shows — and therefore how many it may mark read. The two
// numbers have to be the same one: the route returns 20, and marking all 20
// while rendering 8 would clear a dozen notifications the reader never saw.
const PANEL_LIMIT = 8

export default function NotificationBell({
  initialUnread,
  emptyHint,
  emptyAction,
  tone = 'light',
}: {
  initialUnread: number
  /** What to say when there is nothing — never a blank panel. */
  emptyHint: string
  emptyAction: { label: string; href: string }
  /**
   * 'dark' is the admin bar, which is tm-black. The default trigger is navy on
   * white and would be invisible there; on a dark surface the brand's readable
   * member is tm-mint, which is what the footer and the admin wordmark already
   * use. Only the TRIGGER changes — the panel stays a white card in both, so
   * there is one set of contrast pairs to keep passing rather than two.
   */
  tone?: 'light' | 'dark'
}) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(initialUnread)
  const [items, setItems] = useState<NotificationRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let live = true
    setFailed(false)
    ;(async () => {
      try {
        const r = await fetch('/api/notifications?group=all', { signal: submitSignal(),
          headers: { accept: 'application/json' },
        })
        if (!r.ok) throw new Error(String(r.status))
        const data = (await r.json()) as { items: NotificationRow[]; unread: number }
        if (!live) return
        setItems(data.items)
        setUnread(data.unread)

        // Only what was actually rendered.
        const shown = data.items
          .slice(0, PANEL_LIMIT)
          .filter((n) => !n.read_at)
          .map((n) => n.id)
        if (shown.length === 0) return
        const marked = await fetch('/api/notifications/read', { signal: submitSignal(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: shown }),
        })
        if (marked.ok && live) {
          const { unread: left } = (await marked.json()) as { unread: number }
          setUnread(left)
        }
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [open])

  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className={`relative inline-flex h-11 min-h-[44px] w-11 items-center justify-center rounded-xl border transition-colors ${
          tone === 'dark'
            ? 'border-white/20 bg-white/10 text-tm-mint hover:border-tm-mint'
            : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
        }`}
      >
        <Bell aria-hidden size={17} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-tm-red px-1 text-[10px] font-black text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-tm-black/40 sm:hidden"
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+8px)] sm:max-h-[70vh] sm:w-80 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
              <h2 className="text-xs font-black uppercase tracking-wide text-tm-navy">
                Notifications
              </h2>
              <Link
                href="/account/notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] font-bold text-tm-red hover:underline"
              >
                See all
              </Link>
            </div>

            {items === null && !failed && (
              <p className="flex items-center justify-center gap-2 p-6 text-xs text-gray-500">
                <Loader2 aria-hidden size={14} className="animate-spin" />
                Loading…
              </p>
            )}

            {failed && (
              <p className="p-4 text-center text-xs font-bold text-tm-red">
                Could not load notifications.
              </p>
            )}

            {items !== null && items.length === 0 && (
              <div className="space-y-3 p-6 text-center">
                <p className="text-xs font-bold text-tm-navy">Nothing yet</p>
                <p className="text-xs leading-relaxed text-gray-500">{emptyHint}</p>
                <Link
                  href={emptyAction.href}
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy"
                >
                  {emptyAction.label}
                </Link>
              </div>
            )}

            {items !== null && items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {items.slice(0, PANEL_LIMIT).map((n) => (
                  <li key={n.id}>
                    <NotificationLine row={n} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NotificationLine({ row, onNavigate }: { row: NotificationRow; onNavigate: () => void }) {
  const inner = (
    <>
      <span className="flex items-start gap-2">
        {!row.read_at && (
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tm-red" />
        )}
        <span className={`min-w-0 text-xs ${row.read_at ? 'font-semibold' : 'font-black'} text-tm-navy`}>
          {row.title}
        </span>
      </span>
      {row.body && <span className="block pt-0.5 text-[11px] leading-relaxed text-gray-500">{row.body}</span>}
      <span className="block pt-0.5 text-[10px] text-gray-500"><TimeAgo iso={row.created_at} /></span>
    </>
  )

  // Every notification is about something. When it carries a destination it is
  // a link to that thing; when it does not — a plan expiring, say — it is not
  // dressed up as one, because a link that goes nowhere is worse than plain
  // text.
  return row.href ? (
    <Link
      href={row.href}
      onClick={onNavigate}
      className="block min-h-[44px] px-4 py-3 transition-colors hover:bg-tm-bg"
    >
      {inner}
    </Link>
  ) : (
    <div className="min-h-[44px] px-4 py-3">{inner}</div>
  )
}
