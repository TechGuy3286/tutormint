'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { formatDateTime } from '@/lib/datetime'
import type { TimelineItem, TimelineTone } from '@/lib/memberTimelineCore'

// One line of the merged member timeline (owner, 20 Oct 2026), drawn the same
// whether the server rendered it or "Show more" appended it. A grouped line
// ("Updated their profile ×8 (10:46–10:53 pm)") and a visit ("Visited
// TutorMint — 6 min · 4 pages") open to show what they stand for. The text is
// built by lib/memberTimelineCore — plain English, never raw codes, and message
// events carry no message text.

export type TimelineEvent = TimelineItem

const TONE: Record<TimelineTone, string> = {
  red: 'bg-tm-tint-red text-tm-red',
  gold: 'bg-tm-tint-gold text-tm-gold-ink',
  green: 'bg-tm-tint-green text-tm-green-deep',
  grey: 'bg-slate-100 text-slate-700',
}

type Page = { id: string; text: string; at: string }

export default function TimelineRow({ event: e, memberId }: { event: TimelineEvent; memberId: string }) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<Page[] | null>(null)
  const [loading, setLoading] = useState(false)
  const expandable = (e.children && e.children.length > 1) || !!e.sessionId

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && e.sessionId && pages === null && !loading) {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/admin/activity/session-pages?userId=${encodeURIComponent(memberId)}&sessionId=${encodeURIComponent(e.sessionId)}`,
        )
        const data = (await res.json()) as { rows?: Page[] }
        setPages(res.ok ? (data.rows ?? []) : [])
      } catch {
        setPages([])
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex min-h-[28px] flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`min-w-0 flex-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[e.tone]}`}>
          {e.text}
          {e.count > 1 && <> ×{e.count}</>}
          {e.range && <span className="font-normal"> ({e.range})</span>}
        </span>
        {e.who && <span className="shrink-0 text-[11px] font-semibold text-slate-700">{e.who}</span>}
        <span className="shrink-0 text-[11px] text-gray-500">{formatDateTime(e.at)}</span>
        {expandable && (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-expanded={open}
            className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-tm-navy hover:bg-tm-bg"
          >
            {open ? <ChevronUp aria-hidden size={12} /> : <ChevronDown aria-hidden size={12} />}
            {e.sessionId ? (open ? 'Hide pages' : 'Pages') : open ? 'Hide' : 'Show each'}
          </button>
        )}
      </div>
      {open && e.children && e.children.length > 1 && (
        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
          {e.children.map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 text-slate-700">
                {c.text}
                {c.who ? ` · ${c.who}` : ''}
              </span>
              <span className="shrink-0 text-gray-500">{formatDateTime(c.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {open && e.sessionId && (
        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
          {loading && <li className="text-[11px] text-gray-500">Loading the pages…</li>}
          {pages && pages.length === 0 && <li className="text-[11px] text-gray-500">No pages recorded in this visit.</li>}
          {(pages ?? []).map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-slate-700">{p.text}</span>
              <span className="shrink-0 text-gray-500">{formatDateTime(p.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
