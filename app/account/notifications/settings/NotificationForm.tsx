'use client'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'

export default function NotificationForm({ optedOut }: { optedOut: boolean }) {
  const [wantsEmail, setWantsEmail] = useState(!optedOut)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const save = async (next: boolean) => {
    // Optimistic: the switch moves at once, and moves back if the save fails.
    // Waiting on a round trip to redraw a toggle makes the page feel broken.
    const previous = wantsEmail
    setWantsEmail(next)
    setBusy(true)
    setMessage(null)

    try {
      const res = await fetch('/api/account/notifications', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOptOut: !next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not save.')
      setMessage({ kind: 'ok', text: 'Saved.' })
    } catch (e) {
      setWantsEmail(previous)
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'That did not save.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <input
          type="checkbox"
          checked={wantsEmail}
          disabled={busy}
          onChange={(e) => save(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-tm-navy">
            Email me about new messages and updates
          </span>
          <span className="block pt-1 text-xs leading-relaxed text-gray-500">
            A short email when someone messages you, at most one an hour. It never contains the
            message itself — you read that on TutorMint. Also covers the welcome email.
          </span>
        </span>
      </label>

      {message && (
        <p
          className={`rounded-xl border p-3 text-xs font-bold ${
            message.kind === 'ok'
              ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
              : 'border-tm-red/30 bg-tm-tint-red text-tm-red'
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
