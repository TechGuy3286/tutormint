'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Phone, UserRound } from 'lucide-react'

import { parseContactNumber } from '@/lib/tuitionContactCore'
import { formMayOpen, linkedParent, type NumberFirstOutcome, type ParentAccount } from '@/lib/numberFirstCore'
import { formatDate } from '@/lib/datetime'

// "Number first" (owner, 31 Oct 2026): step one of staff Post a tuition, and of
// the admin edit when the number changes. Only the parent's phone number; the
// server (/api/admin/jobs/number-check, rules lib/numberFirstCore) checks it
// before the rest of the form opens. Numbers are shown masked.

export type NumberPassed = { phone: string; masked: string; parent: ParentAccount | null }

const STATUS_WORD: Record<string, string> = { open: 'Open', paused: 'Paused' }

export default function NumberFirstGate({
  where,
  jobId,
  initialPhone = '',
  onPassed,
  heading = "Parent's phone number",
}: {
  where: 'post' | 'edit'
  jobId?: string
  initialPhone?: string
  onPassed: (r: NumberPassed) => void
  heading?: string
}) {
  const [phone, setPhone] = useState(initialPhone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<NumberFirstOutcome | null>(null)
  const inFlight = useRef(false)

  const check = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (inFlight.current) return
    setError(null)
    setOutcome(null)
    const n = parseContactNumber(phone)
    if (!n.ok) {
      setError(n.error)
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/admin/jobs/number-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, jobId: jobId ?? null, where }),
      })
      const j = (await res.json().catch(() => ({}))) as { outcome?: NumberFirstOutcome; error?: string }
      if (!res.ok || !j.outcome) {
        setError(j.error ?? 'We could not check this number just now. Please try again.')
        return
      }
      setOutcome(j.outcome)
      // Clear, or a parent account with no live tuition: the form opens at once.
      if (formMayOpen(j.outcome, false)) onPassed({ phone, masked: j.outcome.masked, parent: linkedParent(j.outcome) })
    } catch {
      setError('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-live="polite">
      <form onSubmit={check} className="space-y-2">
        <label htmlFor="number-first" className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
          <Phone aria-hidden size={15} /> {heading}
        </label>
        <p className="text-xs text-gray-600">Enter it first. We check it before the rest of the form opens.</p>
        <div className="flex flex-wrap gap-2">
          <input
            id="number-first"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setOutcome(null)
            }}
            placeholder="0300 1234567"
            inputMode="tel"
            autoComplete="off"
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-tm-navy outline-none focus:border-tm-red"
          />
          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:bg-gray-200 disabled:text-slate-700"
          >
            {busy ? 'Checking…' : 'Check number'}
          </button>
        </div>
      </form>

      {error && <p className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">{error}</p>}

      {outcome && (outcome.kind === 'do_not_use' || outcome.kind === 'on_hold') && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          <AlertTriangle aria-hidden size={15} className="mt-px shrink-0" />
          <span>
            {outcome.message} <span className="font-semibold">({outcome.masked})</span>
          </span>
        </p>
      )}

      {outcome && outcome.kind === 'existing' && (
        <div className="space-y-2 rounded-xl bg-tm-tint-gold p-3 text-xs text-tm-gold-ink">
          <p className="font-bold">
            {outcome.masked} is already on {outcome.tuitions.length === 1 ? 'this tuition' : `these ${outcome.tuitions.length} tuitions`}:
          </p>
          <ul className="space-y-1.5">
            {outcome.tuitions.map((t) => (
              <li key={t.id} className="rounded-lg bg-white p-2 text-slate-700">
                <span className="font-bold text-tm-navy">{t.ref ?? 'TM'}</span> · {t.title}
                <span className="block text-[11px] text-gray-600">
                  {[t.city, STATUS_WORD[t.status] ?? t.status, `posted ${formatDate(t.postedAt)}`, `by ${t.poster}`].filter(Boolean).join(' · ')}
                </span>
                <Link href={t.href} className="mt-1 inline-flex min-h-[36px] items-center font-bold text-tm-navy underline">
                  Open it
                </Link>
              </li>
            ))}
          </ul>
          {outcome.parent && <ParentLine parent={outcome.parent} />}
          <button
            type="button"
            onClick={() => onPassed({ phone, masked: outcome.masked, parent: outcome.parent })}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-tm-navy bg-white px-4 font-bold text-tm-navy hover:bg-tm-tint-navy"
          >
            Continue anyway
          </button>
        </div>
      )}

      {outcome && outcome.kind === 'parent_account' && <ParentLine parent={outcome.parent} />}

      {outcome && outcome.kind === 'clear' && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-tm-green-deep">
          <CheckCircle2 aria-hidden size={14} /> {outcome.masked} is clear.
        </p>
      )}
    </section>
  )
}

function ParentLine({ parent }: { parent: ParentAccount }) {
  return (
    <p className="flex items-center gap-1.5 rounded-xl bg-tm-tint-navy p-2.5 text-xs font-bold text-tm-navy">
      <UserRound aria-hidden size={14} />
      <span>
        This parent has an account (
        <Link href={`/admin/users/${parent.id}`} className="underline">
          {parent.name}
        </Link>
        ). The new tuition will be linked to it.
      </span>
    </p>
  )
}
