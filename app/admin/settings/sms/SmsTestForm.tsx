'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

// "Send test SMS" (Owner only — the page renders this only for the Owner, and the
// route refuses everyone else). Shows SendPK's answer as it came back.

type Answer =
  | { ok: true; to: string; provider: string; messageId: string | null; stamp: string }
  | { ok: false; to?: string; provider?: string; error: string }

export default function SmsTestForm() {
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/admin/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) {
        setAnswer(j as Answer)
        toast.success('SendPK accepted the test message.')
      } else {
        setAnswer({ ok: false, to: j.to, provider: j.provider, error: j.error ?? `The test was not sent (HTTP ${res.status}).` })
        toast.error(j.error ?? 'The test was not sent.')
      }
      router.refresh()
    } catch {
      setAnswer({ ok: false, error: 'We could not reach TutorMint. Check your internet connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-black text-tm-navy">Send test SMS</h2>
      <p className="text-xs text-gray-500">
        Sends one message through the same SendPK connection the verification codes use. SendPK only sends TutorMint&rsquo;s
        approved code message, so your phone will show &ldquo;Your TutorMint verification code is …&rdquo; with the
        Pakistan time of the test (for example 114830 for 11:48:30) in place of a code. It is not a code and verifies
        nothing. Up to 5 tests an hour; each is recorded in the Audit log with the number masked.
      </p>
      <form onSubmit={send} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="block text-[11px] font-bold text-gray-600">Mobile number</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0300 1234567"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !phone.trim()}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send test SMS'}
        </button>
      </form>
      {answer ? (
        answer.ok ? (
          <p className="rounded-xl bg-tm-tint-green p-3 text-xs text-tm-green-deep">
            Sent to {answer.to}. SendPK accepted it{answer.messageId ? ` (message id ${answer.messageId})` : ''}. Your phone should
            show {answer.stamp} in the message. Accepted means SendPK took it, not that the phone has received it yet.
          </p>
        ) : (
          <p className="rounded-xl bg-tm-tint-red p-3 text-xs text-tm-red">
            Not sent{answer.to ? ` to ${answer.to}` : ''}. {answer.provider === 'sendpk' ? 'SendPK said: ' : ''}
            {answer.error}
          </p>
        )
      ) : null}
    </section>
  )
}
