'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, Phone } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { CONTACT_OUTCOMES, OUTCOME_LABEL, type ContactOutcome } from '@/lib/staffOutreachCore'
import type { UnpaidRow } from '@/lib/staffOutreach'

// One unpaid signup (owner, 8 Oct 2026): who, where they stopped, WhatsApp and
// Call, the last contact, and a one-line outcome log.

export default function UnpaidSignupRow({ row }: { row: UnpaidRow }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [outcome, setOutcome] = useState<ContactOutcome | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!outcome) {
      toast.error('Choose what happened on the call.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/outreach/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId: row.id, outcome, note: note.trim() || undefined }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success('Contact logged.')
    setOutcome('')
    setNote('')
    router.refresh()
  }

  return (
    <li className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/admin/users/${row.id}`} className="text-sm font-black text-tm-navy hover:underline">
          {row.name}
        </Link>
        <span className="text-[11px] text-gray-600">
          {row.city ?? 'No city yet'} · joined {formatDate(row.joinedAt)}
        </span>
      </div>
      <p className="text-xs text-slate-700">
        {row.completion}% complete
        {row.stoppedAt && <span className="font-bold text-tm-red"> · Stopped at: {row.stoppedAt}</span>}
      </p>

      <div className="flex flex-wrap gap-2">
        {row.waHref ? (
          <a
            href={row.waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover"
          >
            <MessageCircle aria-hidden size={15} /> WhatsApp
          </a>
        ) : null}
        {row.telHref ? (
          <a
            href={row.telHref}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy"
          >
            <Phone aria-hidden size={15} /> Call
          </a>
        ) : (
          <span className="text-[11px] text-gray-500">No mobile number on file.</span>
        )}
      </div>

      <p className="text-[11px] text-gray-600">
        {row.lastContact ? (
          <>
            Last contact: <strong className="text-slate-800">{OUTCOME_LABEL[row.lastContact.outcome]}</strong> ·{' '}
            {row.lastContact.staffEmail ?? 'staff'} · {formatDateTime(row.lastContact.at)}
            {row.lastContact.note ? ` — “${row.lastContact.note}”` : ''}
          </>
        ) : (
          'Not contacted yet.'
        )}
      </p>

      {!readOnly && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[150px] flex-1">
          <span className="mb-1 block text-[11px] font-bold text-gray-600">Outcome</span>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as ContactOutcome | '')}
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs"
          >
            <option value="">Choose…</option>
            {CONTACT_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[180px] flex-[2]">
          <span className="mb-1 block text-[11px] font-bold text-gray-600">Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Log contact'}
        </button>
      </div>}
    </li>
  )
}
