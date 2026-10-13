'use client'

import { useState } from 'react'
import { BellRing, Check } from 'lucide-react'

// "Notify me when a matching tutor joins" (owner, 13 Oct 2026) — shown when a
// tutor search finds nobody. The parent leaves a mobile number or an email and
// ticks a clear opt-in. They get ONE message when a tutor matching the search
// joins, and nothing else. No sign-in needed.

export default function NotifyMe({
  q,
  city,
  area,
  subjectId,
}: {
  q?: string | null
  city?: string | null
  area?: string | null
  subjectId?: number | null
}) {
  const [contact, setContact] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!consent) {
      setError('Tick the box to agree to one message.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/search/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, consent, q: q || null, city: city || null, area: area || null, subjectId: subjectId ?? null }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; channel?: string }
      if (!res.ok) {
        setError(data.error ?? 'That did not save. Please try again.')
        return
      }
      setDone(data.channel === 'email' ? 'We will email you once, when a matching tutor joins.' : 'We will text you once, when a matching tutor joins.')
    } catch {
      setError('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green p-4 text-xs font-bold text-tm-green-deep">
        <Check aria-hidden size={16} className="mt-px shrink-0" />
        {done}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-black text-tm-navy">
        <BellRing aria-hidden size={16} />
        Notify me when a matching tutor joins
      </p>
      <label className="block space-y-1">
        <span className="block text-[11px] font-bold text-gray-600">Mobile number or email</span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          inputMode="email"
          autoComplete="off"
          placeholder="0300 1234567 or you@example.com"
          maxLength={200}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none"
        />
      </label>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-tm-navy" />
        <span>Send me one message when a tutor matching this search joins.</span>
      </label>
      {error && (
        <p role="alert" className="text-xs font-bold text-tm-red">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || contact.trim().length < 5}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Notify me'}
      </button>
      <p className="text-[11px] text-gray-600">One message only. No other messages, and your number or email is not shown to anyone.</p>
    </form>
  )
}
