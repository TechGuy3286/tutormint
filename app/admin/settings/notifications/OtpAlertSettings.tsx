'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { OtpAlertSettings as Settings } from '@/lib/otpAlerts'

// "Who gets OTP alerts" (owner, 23 Nov 2026 — PR-18 Part C.2). Owner only;
// the Partner sees it read-only. Today's count and the daily-budget warning
// come from the server.

export default function OtpAlertSettings({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [chosen, setChosen] = useState<Set<string>>(new Set(initial.staff.filter((s) => s.checked).map((s) => s.id)))
  const [digest, setDigest] = useState(initial.digest)
  const [busy, setBusy] = useState(false)
  const dirty = digest !== initial.digest || initial.staff.some((s) => s.checked !== chosen.has(s.id))

  const save = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/settings/otp-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [...chosen], digest }),
    })
    setBusy(false)
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success('Saved. Alerts go to the people you chose.')
    router.refresh()
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" aria-label="Who gets OTP alerts">
      <div className="space-y-1">
        <h2 className="text-sm font-black text-tm-navy">Who gets OTP alerts</h2>
        <p className="text-xs text-gray-600">
          An email when a new tutor or parent verifies their mobile: name, role, city, sign-up time and steps done, with an
          Open in admin button. Never a phone number, email, CNIC or amount.
        </p>
        <p className="text-xs font-semibold text-slate-700">
          Today: {initial.alertsToday} alert {initial.alertsToday === 1 ? 'email' : 'emails'} · {initial.emailsToday} of {initial.dailyLimit} emails sent in all
        </p>
      </div>
      {initial.warning && <p className="rounded-xl bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink">{initial.warning}</p>}
      <ul className="space-y-1">
        {initial.staff.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-tm-navy">
              <input
                type="checkbox"
                className="h-5 w-5"
                disabled={!canEdit}
                checked={chosen.has(s.id)}
                onChange={(e) =>
                  setChosen((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(s.id)
                    else next.delete(s.id)
                    return next
                  })
                }
              />
              {s.name}
              {s.isOwner && <span className="text-gray-600">(Owner)</span>}
            </label>
          </li>
        ))}
      </ul>
      <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-tm-navy">
        <input type="checkbox" className="h-5 w-5" disabled={!canEdit} checked={digest} onChange={(e) => setDigest(e.target.checked)} />
        Send a 15-minute digest instead
      </label>
      <p className="text-[11px] text-gray-600">
        If the day&apos;s emails get close to the limit, alerts stop until tomorrow and your bell rings once. Receipts, codes and
        member emails always go first.
      </p>
      {canEdit && (
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:bg-gray-300"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}
    </section>
  )
}
