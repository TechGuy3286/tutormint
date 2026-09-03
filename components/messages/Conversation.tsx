'use client'

import { submitSignal } from '@/lib/submit'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Lock, ShieldAlert, ChevronUp, Loader2 } from 'lucide-react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import Avatar from '@/components/Avatar'
import { formatDate, formatDateTime, pkDayKey } from '@/lib/datetime'
import type { ThreadMessage } from '@/lib/messaging'

// The right pane: one conversation, oldest at the top, and the composer.
//
// Bodies arrive ALREADY MASKED when the pair may not exchange numbers -- the
// digits never reach this component, so there is nothing here to reveal with
// dev tools. The chip explains why something is hidden, which is the
// difference between a paywall people understand and one they resent.
//
// A chat is read downwards and paged upwards. Both directions live here: the
// newest window is rendered by the server, and older windows are PREPENDED,
// holding the scroll position by measuring the container before and after --
// otherwise loading history yanks the reader away from what they were reading,
// which is the one thing an infinite chat must not do.

export default function Conversation({
  threadId,
  otherId,
  otherName,
  otherAvatar,
  initial,
  initialCursor,
  canShareContact,
  suspended,
  upgradeHref,
}: {
  threadId: string
  otherId: string
  otherName: string
  otherAvatar: string | null
  /** Oldest-first, the newest window of the conversation. */
  initial: ThreadMessage[]
  initialCursor: string | null
  canShareContact: boolean
  suspended: boolean
  /** Where "unlock contact details" goes, for THIS member's audience. */
  upgradeHref: string
}) {
  const router = useRouter()
  const upgradeSheet = useUpgradeSheet()

  const [older, setOlder] = useState<ThreadMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  const messages = [...older, ...initial]

  // --------------------------------------------------------------- read ----
  // On mount, not during the server render: Next prefetches links, and
  // clearing the unread dot for a conversation somebody only hovered over is
  // worse than clearing it a beat late.
  useEffect(() => {
    void fetch('/api/messages/read', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId }),
    })
      .then(() => router.refresh())
      .catch(() => {})
    // Once per conversation. router is stable and re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // ------------------------------------------------------------- scroll ----
  // Straight to the newest message, without an animation: this is where the
  // conversation starts, not somewhere it travelled to.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [threadId])

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    const el = scroller.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const r = await fetch(
        `/api/messages/history?threadId=${threadId}&cursor=${encodeURIComponent(cursor)}`,
        { signal: submitSignal(), headers: { accept: 'application/json' } },
      )
      if (!r.ok) throw new Error(String(r.status))
      const page = (await r.json()) as { items: ThreadMessage[]; cursor: string | null }
      setOlder((prev) => [...page.items, ...prev])
      setCursor(page.cursor)
      // After paint, put the reader back on the message they were looking at.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before
      })
    } catch {
      // The cursor is untouched, so the button retries exactly this request.
    } finally {
      setLoadingOlder(false)
    }
  }, [cursor, loadingOlder, threadId])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    const r = await postGated('/api/messages', { threadId, body }, upgradeSheet?.showGate)
    if (r.ok) {
      setDraft('')
      router.refresh()
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
    } else if (!r.gated) {
      // A refused send keeps the draft: the member has not made a mistake, and
      // retyping the message would be a second punishment.
      setError(r.error)
    }
    setBusy(false)
  }

  const block = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/blocks', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otherId }),
      })
      const json = await res.json()
      setNotice(
        res.ok
          ? `${otherName} is blocked. Neither of you can message or apply to the other.`
          : (json.error ?? 'Could not block.'),
      )
      setMenuOpen(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const report = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/reports', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportedId: otherId,
          targetType: 'thread',
          targetId: threadId,
          reason: 'harassment',
        }),
      })
      const json = await res.json()
      setNotice(res.ok ? json.message : (json.error ?? 'Could not report.'))
      setMenuOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const anyMasked = messages.some((m) => m.masked)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {cursor && (
          <div className="pb-3 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:text-gray-500"
            >
              {loadingOlder ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <ChevronUp size={13} aria-hidden />
              )}
              Load earlier messages
            </button>
          </div>
        )}

        {notice && (
          <p className="mb-3 rounded-xl border border-gray-200 bg-white p-3 text-[11px] font-semibold text-slate-700">
            {notice}
          </p>
        )}

        {messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-gray-500">
            No messages yet. Say hello — messages stay inside TutorMint so both sides are protected.
          </p>
        ) : (
          <ol className="space-y-1">
            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1] : null
              // A separator whenever the calendar day changes, in Pakistan
              // time. pkDayKey is what decides it, so the line and the
              // timestamps under the bubbles cannot disagree about the date.
              const showDay = !prev || pkDayKey(m.createdAt) !== pkDayKey(prev.createdAt)
              // The avatar marks the START of a run, not every line. Six
              // messages in a row from one person is one conversational turn,
              // and repeating the face beside each of them turns a thread into
              // a column of the same photo. A day break starts a new run: after
              // a gap of hours, who is speaking is worth restating.
              const startsRun = !prev || prev.mine !== m.mine || showDay
              return (
                <li key={m.id} className="space-y-1">
                  {showDay && (
                    <p className="py-3 text-center text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {formatDate(m.createdAt)}
                    </p>
                  )}
                  <div className={`flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    {/* No avatar on own messages: the reader knows who they
                        are, and a face on both sides is two columns of noise
                        for one bit of information. The spacer keeps the runs
                        aligned when the avatar is not drawn. */}
                    {!m.mine &&
                      (startsRun ? (
                        <Avatar
                          name={otherName}
                          src={otherAvatar}
                          seed={otherId}
                          className="h-7 w-7 shrink-0 text-[10px]"
                          ring=""
                          decorative
                        />
                      ) : (
                        <span aria-hidden className="h-7 w-7 shrink-0" />
                      ))}
                    <div
                      className={`max-w-[80%] space-y-1 rounded-2xl px-3 py-2 sm:max-w-[68%] ${
                        m.mine
                          ? // Own messages: right, on the brand's own tint, with
                            // a squared corner on the side they came from. The
                            // shape is the second signal -- a reader scanning
                            // quickly reads the edge before the colour, and it
                            // still works for anyone who cannot separate the
                            // two colours at all.
                            'rounded-br-md bg-tm-tint-navy text-tm-navy'
                          : 'rounded-bl-md border border-gray-200 bg-white text-slate-700'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                        {m.body}
                      </p>
                      <p className={`text-[10px] ${m.mine ? 'text-tm-navy/70' : 'text-gray-500'}`}>
                        {formatDateTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {anyMasked && !canShareContact && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-tm-tint-gold p-3 text-[11px] leading-relaxed text-tm-gold-ink">
            <Lock size={14} className="mt-px shrink-0" aria-hidden />
            <span>
              Phone numbers are hidden in this conversation.{' '}
              <Link href={upgradeHref} className="font-bold underline">
                Upgrade
              </Link>{' '}
              to see contact details once both sides can share them.
            </span>
          </p>
        )}

        <div ref={bottom} aria-hidden />
      </div>

      <div className="border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="space-y-2">
          {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

          {suspended ? (
            // Said plainly rather than letting Send fail. A disabled box with
            // no explanation is how somebody ends up pressing it four times
            // and then emailing support.
            //
            // NOT REACHABLE TODAY, and worth knowing before anyone deletes it
            // as dead code: both dashboard layouts redirect a suspended member
            // to /suspended before this page renders, so what they actually
            // see is that page. Verified -- a suspended tutor opening
            // /tutor/dashboard/messages lands on /suspended, and POST
            // /api/messages answers 403 "Your account is suspended."
            //
            // It stays because the enforcement that matters is server-side and
            // this is the honest UI for the state: if suspension is ever
            // relaxed to read-only access -- which is the natural next step,
            // since a suspended member's threads are already readable -- this
            // is the difference between a composer that explains itself and
            // one that silently refuses.
            <p className="flex items-start gap-2 rounded-xl bg-tm-tint-red p-3 text-[11px] leading-relaxed text-tm-red">
              <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
              <span>
                Your account is suspended, so you cannot send messages.{' '}
                <Link href="/support" className="font-bold underline">
                  Contact support
                </Link>{' '}
                to have it reviewed.
              </span>
            </p>
          ) : (
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                placeholder="Write a message"
                aria-label="Message"
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-3 text-xs outline-none focus:border-tm-red"
              />
              <button
                type="button"
                onClick={send}
                disabled={busy || !draft.trim()}
                aria-label="Send message"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-tm-green-deep px-4 text-white disabled:bg-gray-300"
              >
                <Send size={16} aria-hidden />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="inline-flex min-h-[44px] items-center gap-1 text-[11px] font-bold text-gray-500"
            >
              <ShieldAlert size={12} aria-hidden />
              Safety
            </button>
            {menuOpen && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={report}
                  disabled={busy}
                  className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-slate-700"
                >
                  Report
                </button>
                <button
                  type="button"
                  onClick={block}
                  disabled={busy}
                  className="min-h-[44px] rounded-xl border border-tm-red px-3 text-[11px] font-bold text-tm-red"
                >
                  Block
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
