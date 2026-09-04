'use client'

import { reportSilentFailure } from '@/lib/silentFailure'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, X } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Typeahead from '@/components/search/Typeahead'
import { useInfinite } from '@/lib/useInfinite'
import TimeAgo from '@/components/TimeAgo'
import type { ThreadRow } from '@/lib/messaging'

// The left pane: every conversation this member has had, newest first.
//
// Two things it has to do at once, which is why it is split in two components:
// page forwards forever, and start over when the search changes. `useInfinite`
// only ever APPENDS -- deliberately, because it exists to serve
// server-rendered first pages -- so the searched list is a different list, and
// remounting `Rows` with a key is what says so. Trying to make one hook do
// both would mean teaching it to throw away rows, which is the behaviour the
// browse pages must never have.

const PAGE_SIZE = 20

export default function ConversationList({
  initial,
  initialCursor,
  basePath,
  activeId,
  emptyHint,
  emptyActions = [],
}: {
  initial: ThreadRow[]
  initialCursor: string | null
  /** '/parent/dashboard/messages' or the tutor equivalent. */
  basePath: string
  activeId: string | null
  emptyHint: string
  emptyActions?: { label: string; href: string }[]
}) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ items: ThreadRow[]; cursor: string | null } | null>(null)
  const [searching, setSearching] = useState(false)
  const paneRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort()
    if (!q.trim()) {
      setFound(null)
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setSearching(true)
    try {
      const r = await fetch(`/api/messages/threads?q=${encodeURIComponent(q.trim())}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      })
      if (!r.ok) throw new Error(String(r.status))
      setFound((await r.json()) as { items: ThreadRow[]; cursor: string | null })
    } catch (e) {
      // An aborted request is the normal case here -- the member typed another
      // character -- and the next one lands. Anything else left the search
      // showing nothing with no explanation.
      if (!ctrl.signal.aborted) reportSilentFailure('ConversationList.search', e)
    } finally {
      if (!ctrl.signal.aborted) setSearching(false)
    }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  const key = query.trim()
  const rows = found ? found.items : initial
  const cursor = found ? found.cursor : initialCursor

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-gray-200 p-3">
        {/* suggest={false}, the same call /admin/users makes. The public
            suggestion index holds listed tutors and open jobs; it knows
            nothing about who this member has talked to, so a panel here would
            answer a different question from the one being typed. */}
        <Typeahead
          placeholder="Search conversations"
          ariaLabel="Search conversations"
          suggest={false}
          onQueryChange={(q) => {
            setQuery(q)
            void search(q)
          }}
        />
      </div>

      {rows.length === 0 ? (
        <Empty
          searching={key.length > 0}
          busy={searching}
          hint={emptyHint}
          actions={emptyActions}
          onClear={() => {
            setQuery('')
            setFound(null)
          }}
        />
      ) : (
        <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Rows
            key={key}
            initial={rows}
            initialCursor={cursor}
            query={key}
            basePath={basePath}
            activeId={activeId}
            scrollRoot={paneRef}
          />
        </div>
      )}
    </div>
  )
}

function Rows({
  initial,
  initialCursor,
  query,
  basePath,
  activeId,
  scrollRoot,
}: {
  initial: ThreadRow[]
  initialCursor: string | null
  query: string
  basePath: string
  activeId: string | null
  scrollRoot: React.RefObject<HTMLDivElement | null>
}) {
  const { items, state, done, loadMore, sentinel } = useInfinite<ThreadRow>({
    endpoint: '/api/messages/threads',
    params: { q: query || null },
    initialCursor,
    // The query is part of the identity: coming back to a different search
    // must not restore the previous one's rows.
    storageKey: `inbox:${basePath}:${query}`,
    scrollRoot,
  })

  const all = [...initial, ...items]

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {all.map((t) => (
          <li key={t.id}>
            <Link
              href={`${basePath}/${t.id}`}
              aria-current={t.id === activeId ? 'true' : undefined}
              // Selection is a navy bar plus the page ground, NOT a tint
              // fill: tm-tint-navy darkens the row enough that the timestamp
              // (gray-500, 4.03:1) and the job title (tm-green-deep, 4.21:1)
              // both fall under AA on it. check:contrast caught both. The
              // transparent border on unselected rows keeps the text from
              // shifting 4px sideways as the selection moves.
              className={`flex min-h-[72px] items-center gap-3 border-l-4 px-3 py-3 transition-colors ${
                t.id === activeId
                  ? 'border-tm-navy bg-tm-bg'
                  : 'border-transparent hover:bg-gray-50'
              }`}
            >
              <Avatar
                name={t.otherName}
                src={t.otherAvatar}
                seed={t.otherId}
                className="h-11 w-11 shrink-0 text-xs"
                decorative
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-xs ${
                      t.unread > 0 ? 'font-black text-tm-navy' : 'font-bold text-slate-700'
                    }`}
                  >
                    {t.otherName}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-500">
                    <TimeAgo iso={t.lastMessageAt} />
                  </span>
                </div>
                {t.jobTitle && (
                  <p className="truncate text-[10px] font-semibold text-tm-green-deep">
                    {t.jobTitle}
                  </p>
                )}
                <p
                  className={`truncate text-[11px] ${
                    t.unread > 0 ? 'font-semibold text-slate-700' : 'text-gray-500'
                  }`}
                >
                  {t.preview || 'No messages yet'}
                </p>
              </div>
              {t.unread > 0 && (
                <span
                  className="ml-1 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white"
                  aria-label={`${t.unread} unread`}
                >
                  {t.unread > 9 ? '9+' : t.unread}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <div ref={sentinel} aria-hidden className="h-px" />

      {/* The button is the accessible path and the observer is the
          convenience: a keyboard or screen-reader user may never generate a
          scroll event, and for them a scroll-only list simply ends early with
          nothing saying so. */}
      <div className="p-3 text-center">
        {!done && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={state === 'loading'}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:text-gray-500"
          >
            {state === 'loading' && <Loader2 size={13} className="animate-spin" />}
            {state === 'error' ? 'Could not load. Try again' : 'Load older conversations'}
          </button>
        )}
        {done && all.length > 6 && (
          <p className="text-[10px] text-gray-500">That is every conversation.</p>
        )}
      </div>
    </>
  )
}

function Empty({
  searching,
  busy,
  hint,
  actions,
  onClear,
}: {
  searching: boolean
  busy: boolean
  hint: string
  actions: { label: string; href: string }[]
  onClear: () => void
}) {
  // A filtered empty is a different situation from an empty inbox, and gets a
  // different offer: clearing the search, not "go and find a tutor".
  if (searching) {
    return (
      <div className="space-y-3 p-8 text-center">
        <MessageSquare size={20} className="mx-auto text-gray-300" aria-hidden />
        <p className="text-xs font-bold text-tm-navy">
          {busy ? 'Searching…' : 'No conversations match that'}
        </p>
        {!busy && (
          <button
            type="button"
            onClick={onClear}
            className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            <X aria-hidden size={14} />
            Clear the search
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 p-8 text-center">
      <MessageSquare size={20} className="mx-auto text-gray-300" aria-hidden />
      <div className="space-y-1.5">
        <p className="text-xs font-bold text-tm-navy">No conversations yet</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">{hint}</p>
      </div>
      {actions.length > 0 && (
        <div className="mx-auto flex max-w-xs flex-col gap-2">
          {actions.map((a, i) => (
            <Link
              key={a.href}
              href={a.href}
              className={
                i === 0
                  ? 'flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-slate-700'
                  : 'flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy'
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export { PAGE_SIZE as CONVERSATION_PAGE_SIZE }
