'use client'

import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Send, Lock, ShieldAlert } from 'lucide-react'

// The message list and composer.
//
// Bodies arrive already masked when the pair is not entitled to exchange
// numbers -- the digits never reach this component, so there is nothing here
// to reveal with dev tools. The upgrade chip explains WHY something is hidden,
// which is the difference between a paywall people understand and one they
// resent.

export type RenderedMessage = {
  id: string
  senderId: string
  mine: boolean
  body: string
  masked: boolean
  createdAt: string
}

export default function Thread({
  threadId,
  otherId,
  otherName,
  messages,
  canShareContact,
}: {
  threadId: string
  otherId: string
  otherName: string
  messages: RenderedMessage[]
  canShareContact: boolean
}) {
  const router = useRouter()
  const upgradeSheet = useUpgradeSheet()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    const r = await postGated('/api/messages', { threadId, body }, upgradeSheet?.showGate)
    if (r.ok) {
      setDraft('')
      router.refresh()
    } else if (!r.gated) {
      // A gated send keeps the draft: the member has not made a mistake, they
      // have hit a limit, and retyping the message after upgrading would be a
      // second punishment.
      setError(r.error)
    }
    setBusy(false)
  }

  const block = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/blocks', {
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
      const res = await fetch('/api/reports', {
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
    <>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-4 py-4 sm:px-6">
        {notice && (
          <p className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] font-semibold text-slate-700">
            {notice}
          </p>
        )}

        {messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-gray-500">
            No messages yet. Say hello — messages stay inside TutorMint so both sides are protected.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] space-y-1 rounded-2xl px-3 py-2 sm:max-w-[70%] ${
                  m.mine ? 'bg-tm-black text-white' : 'border border-gray-200 bg-white'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.body}</p>
                <p className={`text-[10px] ${m.mine ? 'text-white/60' : 'text-gray-500'}`}>
                  {new Date(m.createdAt).toLocaleString('en-PK', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))
        )}

        {anyMasked && !canShareContact && (
          <p className="flex items-start gap-2 rounded-xl bg-tm-tint-gold p-3 text-[11px] leading-relaxed text-tm-gold-ink">
            <Lock size={14} className="mt-px shrink-0" />
            <span>
              Phone numbers are hidden in this conversation.{' '}
              <Link href="/parent/packages?plan=parent_featured" className="font-bold underline">
                Featured
              </Link>{' '}
              unlocks contact details once both sides can share them.
            </span>
          </p>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-2xl space-y-2">
          {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

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
              <Send size={16} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-1 text-[11px] font-bold text-gray-500"
            >
              <ShieldAlert size={12} />
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
    </>
  )
}
