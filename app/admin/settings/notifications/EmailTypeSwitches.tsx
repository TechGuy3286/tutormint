'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import type { EmailTypeRow } from '@/lib/email/settings'

// One on/off switch per email type (owner, 27 Oct 2026). adminFetch handles the
// fresh-password prompt; the server checks Owner only and writes Audit.

const GROUPS: { id: EmailTypeRow['group']; title: string; note: string }[] = [
  { id: 'signin', title: 'Sign-in emails', note: 'Always on — they are how a member gets back into their account.' },
  { id: 'staff', title: 'Staff and admin alerts', note: 'Every alert is in the bell. Off by default; when on, it is emailed to the Owner account only.' },
  { id: 'member', title: 'Member emails', note: 'Receipts, decisions and updates to tutors and parents.' },
]

export default function EmailTypeSwitches({ types, dailyLimit }: { types: EmailTypeRow[]; dailyLimit: number }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState<string | null>(null)
  const [limit, setLimit] = useState(String(dailyLimit))

  const post = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key)
    const res = await adminFetch('/api/admin/settings/email-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(null)
    if (!res.ok) {
      toast.error((res.data as { error?: string })?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(done)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <section key={g.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-email-group={g.id}>
          <h2 className="text-sm font-black text-tm-navy">{g.title}</h2>
          <p className="text-[11px] text-gray-500">{g.note}</p>
          <ul className="divide-y divide-gray-100">
            {types
              .filter((t) => t.group === g.id)
              .map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2" data-email-type={t.id} data-on={t.on ? 'on' : 'off'}>
                  <span className="min-w-0 text-xs font-bold text-slate-800">
                    {t.label}
                    {!t.locked && t.on !== t.defaultOn && <span className="ml-2 font-normal text-gray-500">(changed)</span>}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.on}
                    aria-label={t.label}
                    disabled={readOnly || t.locked || busy !== null}
                    onClick={() => void post(t.id, { type: t.id, on: !t.on }, `${t.label}: ${!t.on ? 'on' : 'off'}.`)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${t.on ? 'bg-tm-green-deep' : 'bg-slate-300'}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${t.on ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Daily email limit</h2>
        <p className="text-[11px] text-gray-500">
          From 90% of this a day, only sign-in emails and the Owner&rsquo;s bank-transfer alert are sent; the rest wait for the next day.
          Change it if the Resend plan changes.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={readOnly}
            aria-label="Daily email limit"
            className="min-h-11 w-32 rounded-xl border border-gray-300 px-3 text-sm"
          />
          <button
            type="button"
            disabled={readOnly || busy !== null || Number(limit) === dailyLimit}
            onClick={() => void post('limit', { dailyLimit: Math.floor(Number(limit)) }, 'Daily limit saved.')}
            className="min-h-11 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-200 disabled:text-slate-700"
          >
            Save
          </button>
        </div>
      </section>
      {readOnly && <p className="text-[11px] text-gray-500">View only. The Owner changes these.</p>}
    </div>
  )
}
