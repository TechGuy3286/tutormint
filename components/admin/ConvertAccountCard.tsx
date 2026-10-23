'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { convertButtonLabel, ROLE_WORD, type AccountRole } from '@/lib/convertAccountCore'

// Convert account type (owner, 23 Oct 2026) — the site Owner only; the page
// renders this card only for the Owner and the route refuses everyone else.
// Step 1: the reason and a confirmation. If the person has paid or has an
// approved document, step 2 names them (no numbers) and asks to confirm again.
// The server asks for the password when the last one is over 12 hours old
// (adminFetch handles that).

type Preview = { role: AccountRole; to: AccountRole; name: string; blockers: string[] }

export default function ConvertAccountCard({ memberId, role }: { memberId: string; role: AccountRole }) {
  const router = useRouter()
  const toast = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reason, setReason] = useState('')
  const [confirm1, setConfirm1] = useState(false)
  const [confirm2, setConfirm2] = useState(false)
  const [busy, setBusy] = useState(false)
  const to = ROLE_WORD[role === 'tutor' ? 'parent' : 'tutor']

  const open = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<Preview & { error?: string }>(`/api/admin/members/convert?memberId=${memberId}`)
    setBusy(false)
    if (!ok || !data) return void toast.error(data?.error ?? 'Could not open that. Please try again.')
    setPreview(data)
    setConfirm1(false)
    setConfirm2(false)
  }

  const submit = async () => {
    if (!preview) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; to?: string; emailed?: boolean; needsOverride?: boolean; blockers?: string[] }>('/api/admin/members/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, reason, override: preview.blockers.length > 0 && confirm2 }),
    })
    setBusy(false)
    if (!ok) {
      if (data?.needsOverride && data.blockers) setPreview({ ...preview, blockers: data.blockers })
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    toast.success(`Changed to a ${to} account.${data?.emailed ? ' They were told in the app and by email.' : ' They were told in the app.'}`)
    setPreview(null)
    setReason('')
    router.refresh()
  }

  const needsSecond = !!preview && preview.blockers.length > 0
  const canSubmit = !!preview && reason.trim().length >= 3 && confirm1 && (!needsSecond || confirm2) && !busy

  return (
    <section className="space-y-2 rounded-2xl border border-tm-gold/40 bg-white p-4" aria-label="Account type">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Account type: {ROLE_WORD[role]}</h2>
      {!preview ? (
        <>
          <p className="text-[11px] text-gray-600">For someone who picked the wrong account type at sign-up. Owner only. It can be changed back later with the same button.</p>
          <button
            type="button"
            onClick={() => void open()}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-60"
          >
            <ArrowLeftRight aria-hidden size={14} /> {convertButtonLabel(role)}
          </button>
        </>
      ) : (
        <div role="dialog" aria-label={`Change ${preview.name} to a ${to} account`} className="space-y-3">
          <p className="text-xs font-bold text-slate-800">
            Change {preview.name} from a {ROLE_WORD[preview.role]} account to a {to} account?
          </p>
          <ul className="list-disc space-y-1 ps-5 text-[11px] text-slate-700">
            {preview.to === 'tutor' ? (
              <>
                <li>Same account and login. A tutor profile draft is made with their name and city.</li>
                <li>Any tuitions they posted are kept, marked “posted as a parent”.</li>
                <li>They are sent to the tutor dashboard to finish their profile.</li>
              </>
            ) : (
              <>
                <li>Their tutor profile is hidden, not deleted, and leaves search and the sitemap.</li>
                <li>Its public address sends visitors to Browse tutors for their city.</li>
              </>
            )}
            <li>They are told in the app, and by email if their email is confirmed. No payment is changed or refunded.</li>
          </ul>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-600">Reason (required)</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs" />
          </label>
          <label className="flex min-h-[40px] items-start gap-2 text-xs text-slate-800">
            <input type="checkbox" checked={confirm1} onChange={(e) => setConfirm1(e.target.checked)} className="mt-0.5 h-4 w-4" />
            Yes, change this account to a {to} account.
          </label>
          {needsSecond && (
            <div className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3">
              <p className="text-xs font-bold text-tm-red">This person has things that stay with the account:</p>
              <ul className="list-disc ps-5 text-xs text-tm-red">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <label className="flex min-h-[40px] items-start gap-2 text-xs font-bold text-tm-red">
                <input type="checkbox" checked={confirm2} onChange={(e) => setConfirm2(e.target.checked)} className="mt-0.5 h-4 w-4" />
                I understand. Change it anyway.
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60">
              {busy ? 'Changing…' : `Change to ${to}`}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
