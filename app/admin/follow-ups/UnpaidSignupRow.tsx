'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, RefreshCw } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { planLabel } from '@/lib/display'
import { CONTACT_OUTCOMES, OUTCOME_LABEL, type ContactOutcome } from '@/lib/staffOutreachCore'
import { FOLLOW_CHIP_LABEL, PRIORITY, showWhatsApp, startedLine } from '@/lib/tutorFollowUpCore'
import type { TutorFollowRow } from '@/lib/tutorFollowUps'
import FollowUpActions, { MarkFollowedUp } from '@/components/admin/FollowUpActions'
import ProfileShareButtons from '@/components/admin/ProfileShareButtons'
import NotInterestedButton from '@/components/admin/NotInterestedButton'
import type { ProfileShare } from '@/lib/profileShareCore'

// One tutor on Follow-ups → Tutors (owner, 20 Oct 2026): a SHORT card. Name,
// their most urgent state, one "Next: <step>" line, the started payment in one
// line, who contacted them last, then WhatsApp (prefilled from their own state),
// Call and "Mark as followed up". Everything long — every step still to do, the
// order ID, the call log — is under "See all steps".

const STATE_TONE: Record<string, string> = {
  started: 'bg-tm-tint-red text-tm-red',
  docs_done: 'bg-tm-tint-green text-tm-green-deep',
  stuck: 'bg-tm-tint-gold text-tm-gold-ink',
  not_contacted: 'bg-tm-tint-navy text-tm-navy',
  again: 'bg-tm-tint-gold text-tm-gold-ink',
  contacted: 'bg-tm-tint-green text-tm-green-deep',
}

export default function UnpaidSignupRow({
  row,
  share = null,
  canCheckPayment = false,
  isOwner = false,
}: {
  row: TutorFollowRow
  /** Copy profile link / Share on WhatsApp (owner, 20 Oct 2026). */
  share?: ProfileShare | null
  /** "Check payment status" — Owner and Partner only (the route checks too). */
  canCheckPayment?: boolean
  /** The Owner gets "Review" on a card that is waiting on us. */
  isOwner?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [outcome, setOutcome] = useState<ContactOutcome | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkLine, setCheckLine] = useState<string | null>(null)
  const refresh = () => router.refresh()
  const others = PRIORITY.filter((c) => c !== row.primary && row.chips.includes(c))
  const sp = row.startedPayment
  // Waiting on us: no WhatsApp chase by default (owner, 21 Oct 2026).
  const chase = showWhatsApp(row.chips)
  const REASON_TONE: Record<string, string> = { rejected: 'text-tm-red', waiting: 'text-tm-navy', started: 'text-tm-red' }

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
    refresh()
  }

  const checkPayment = async () => {
    if (!sp) return
    setChecking(true)
    const { ok, data } = await adminFetch<{ error?: string; state?: string; message?: string }>('/api/admin/follow-ups/payment-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: sp.paymentId }),
    })
    setChecking(false)
    if (!ok || !data?.message) {
      toast.error(data?.error ?? 'Could not check that payment. Please try again.')
      return
    }
    setCheckLine(data.message)
    if (data.state === 'paid') {
      toast.success('Paid ✅ — activated.')
      refresh()
    }
  }

  return (
    <li className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/users/${row.id}`} className="text-sm font-black text-tm-navy hover:underline">
            {row.name}
          </Link>
          <p className="text-[11px] text-gray-600">
            {row.city ?? 'No city yet'} · joined {formatDate(row.joinedAt)} · {row.completion}% complete
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATE_TONE[row.primary] ?? ''}`}>
          {FOLLOW_CHIP_LABEL[row.primary]}
        </span>
      </div>

      <p className={`text-xs font-bold ${REASON_TONE[row.reasonKind] ?? 'text-slate-800'}`}>{row.reason}</p>
      {row.notInterested && (
        <p className="text-[11px] font-semibold text-gray-600">
          Not interested · {formatDate(row.notInterested.at)}
          {row.notInterested.by ? ` by ${row.notInterested.by}` : ''}
        </p>
      )}
      {row.next && (
        <p className="text-xs font-bold text-slate-800">
          Next: <span className="text-tm-red">{row.next}</span>
        </p>
      )}
      {sp && (
        <p className="text-xs text-slate-700">{startedLine(formatDateTime(sp.startedAt), planLabel(sp.planCode ?? 'verified') ?? 'Plan', sp.provider)}</p>
      )}
      {others.length > 0 && (
        <p className="text-[10px] font-semibold text-gray-500">Also: {others.map((c) => FOLLOW_CHIP_LABEL[c]).join(' · ')}</p>
      )}
      {row.contacted && <p className="text-[11px] font-semibold text-tm-green-deep">{row.contacted}</p>}
      {checkLine && <p className="text-[11px] font-bold text-tm-navy">{checkLine}</p>}

      {share && <ProfileShareButtons share={share} />}

      <div className="flex flex-wrap gap-2">
        <FollowUpActions
          memberId={row.id}
          source="unpaid"
          templateKey={row.templateKey}
          waHref={chase ? row.waHref : null}
          telHref={row.telHref}
          tab={row.contacted ? 'sent' : 'stuck'}
          toastText="Follow-up recorded"
          onMoved={refresh}
          onRestored={refresh}
          btnClass="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold"
        />
        {canCheckPayment && sp?.provider === 'paypro' && (
          <button
            type="button"
            onClick={() => void checkPayment()}
            disabled={checking}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-60"
          >
            <RefreshCw aria-hidden size={13} /> {checking ? 'Checking…' : 'Check payment status'}
          </button>
        )}
        {!chase && isOwner && (
          <Link
            href={`/admin/users/${row.id}#documents`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
          >
            <ClipboardCheck aria-hidden size={13} /> Review
          </Link>
        )}
        {!row.waHref && !row.telHref && <span className="self-center text-[11px] text-gray-500">No mobile number on file.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        {chase && (
          <MarkFollowedUp memberId={row.id} source="unpaid" templateKey={null} tab="sent" toastText="Follow-up recorded" onMoved={refresh} onRestored={refresh} />
        )}
        <NotInterestedButton memberId={row.id} marked={!!row.notInterested} />
      </div>

      <details className="group rounded-xl border border-gray-100 bg-tm-bg px-3 py-2">
        <summary className="min-h-[32px] cursor-pointer text-[11px] font-bold text-tm-navy">See all steps</summary>
        <div className="mt-2 space-y-2 text-[11px] text-slate-700">
          {row.missing.length > 0 ? (
            <p>
              <span className="font-bold">Still to do:</span> {row.missing.join(', ')}
            </p>
          ) : (
            <p>Every onboarding step is done.</p>
          )}
          {row.docsLabel && <p>Documents: {row.docsLabel}</p>}
          {!chase && row.waHref && !readOnly && (
            <p>
              Waiting on us — no follow-up needed.{' '}
              <a href={row.waHref} target="_blank" rel="noopener noreferrer" className="font-bold text-tm-navy underline">
                Message on WhatsApp anyway
              </a>
            </p>
          )}
          {sp?.providerRef && <p>Order ID: {sp.providerRef}</p>}
          <p>
            {row.lastContact ? (
              <>
                Last call logged: <strong className="text-slate-800">{OUTCOME_LABEL[row.lastContact.outcome]}</strong> ·{' '}
                {formatDateTime(row.lastContact.at)}
                {row.lastContact.note ? ` — “${row.lastContact.note}”` : ''}
              </>
            ) : (
              'No call logged yet.'
            )}
          </p>
          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[150px] flex-1">
                <span className="mb-1 block text-[11px] font-bold text-gray-600">Call outcome</span>
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
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs"
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
            </div>
          )}
        </div>
      </details>
    </li>
  )
}
