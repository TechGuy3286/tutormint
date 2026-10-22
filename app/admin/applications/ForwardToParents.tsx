'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Loader2, MessageCircle, Phone } from 'lucide-react'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import StatusChip from '@/components/admin/StatusChip'
import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import TimeAgo from '@/components/TimeAgo'
import AddParentNumber from '@/components/admin/AddParentNumber'
import type { ForwardCard, ForwardTutor } from '@/lib/applicantForwards'
import {
  OUTCOME_LABEL,
  OUTCOME_NEEDS_TUTOR,
  buildForwardMessage,
  forwardWaLink,
  forwardedLine,
  type OutcomeKind,
} from '@/lib/applicantForwardCore'

// The "Forward to parents" panel (owner, 22 Oct 2026, Applications v3). It
// replaced the separate Forward to parents tab: the button on each tuition
// group on Admin → Tuitions → Applications opens this panel for that tuition.
// Everything the old card did is here — the tuition, its parent (masked
// number), every PAID tutor who applied or viewed the number (photo or grey
// silhouette, name, badges, subjects, city, profile link, a tick box; new ones
// pre-ticked, earlier ones "already sent"), WhatsApp parent with the
// "Applicants to forward" template, Call parent, Mark as forwarded (moves the
// ticked tutors' applications to Forwarded and records a parent follow-up on
// each, so they go to Sent), "Add parent number", and "What did the parent
// say?". A view-only role sees no action; the APIs refuse them as well.

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export default function ForwardPanel({
  card,
  template,
  canOpenMembers,
  nowMs,
  title,
  onClose,
}: {
  /** The tuition's forward card, or null when no paid tutor applied or viewed the number. */
  card: ForwardCard | null
  template: string
  canOpenMembers: boolean
  nowMs: number
  title: string
  onClose: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Forward to parents: ${title}`} className="fixed inset-0 z-50 flex justify-end bg-tm-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-tm-bg p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-tm-navy">Forward to parents</h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-slate-700">
            Close
          </button>
        </div>
        {card ? (
          <ul>
            <ForwardCardView card={card} template={template} canOpenMembers={canOpenMembers} nowMs={nowMs} />
          </ul>
        ) : (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
            No tutor who has paid the Verification Fee has applied to this tuition or viewed its number yet, so there is nobody to forward.
          </p>
        )}
      </div>
    </div>
  )
}

function ForwardCardView({ card, template, canOpenMembers, nowMs }: { card: ForwardCard; template: string; canOpenMembers: boolean; nowMs: number }) {
  const readOnly = useAdminReadOnly()
  const toast = useToast()
  const router = useRouter()
  const { state } = card
  // Pre-selected: only the tutors not sent yet. Earlier ones read "already sent"
  // and can still be ticked to send again.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(state.newTutorIds))
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<OutcomeKind | ''>('')
  const [outcomeTutor, setOutcomeTutor] = useState('')
  const [note, setNote] = useState('')

  const chosen = card.tutors.filter((t) => selected.has(t.id))
  const message = buildForwardMessage({
    template,
    parentName: card.parent.name,
    tuitionTitle: card.title,
    area: card.place || card.area,
    tutors: chosen.map((t) => ({ name: t.name, profileUrl: t.profileUrl })),
  })
  const waHref = chosen.length > 0 ? forwardWaLink(card.parent.msisdn, message) : null
  const telHref = card.parent.msisdn ? `tel:+${card.parent.msisdn}` : null

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const markForwarded = async (channel: 'whatsapp' | 'call' | 'other') => {
    if (chosen.length === 0) {
      toast.error('Tick at least one tutor to include.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/applicant-forwards/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: card.jobId, channel, tutorIds: chosen.map((t) => t.id) }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`Marked as forwarded (${chosen.length} ${chosen.length === 1 ? 'tutor' : 'tutors'}).`)
    router.refresh()
  }

  const saveOutcome = async () => {
    if (!outcome) return
    if (OUTCOME_NEEDS_TUTOR[outcome] && !outcomeTutor) {
      toast.error('Choose which tutor.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/applicant-forwards/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: card.jobId, outcome, tutorId: OUTCOME_NEEDS_TUTOR[outcome] ? outcomeTutor : null, note: note.trim() || null }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success('Outcome saved.')
    router.refresh()
  }

  const outcomeTutorName = state.lastOutcome?.tutorId ? card.tutors.find((t) => t.id === state.lastOutcome?.tutorId)?.name : null

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      {/* The tuition */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {card.ref && <span className="rounded-md bg-tm-tint-navy px-1.5 py-0.5 font-mono text-[10px] font-black text-tm-navy">{card.ref}</span>}
          <StatusChip status={card.status} />
          {state.newApplicant && <span className="rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-bold text-tm-red">New applicant</span>}
          {state.checkWithParent && <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">Check with parent</span>}
        </div>
        <Link href={`/admin/jobs/${card.jobId}`} className="block text-sm font-black leading-snug text-tm-navy hover:underline">
          {card.title}
        </Link>
        <p className="text-[11px] text-slate-700">
          {[card.level, card.subjects.slice(0, 4).join(', ') + (card.subjects.length > 4 ? ` +${card.subjects.length - 4} more` : '')].filter(Boolean).join(' · ')}
        </p>
        <p className="text-[11px] text-gray-600">
          {[card.place, `Posted ${formatDate(card.postedAt)}`].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* The parent */}
      <div className="rounded-xl bg-tm-bg p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600">Parent</p>
        <p className="text-xs font-bold text-slate-800">{card.parent.name ?? 'No name on the tuition'}</p>
        <p className="font-mono text-[11px] text-slate-700">{card.parent.phoneLabel ?? 'No contact number on the tuition'}</p>
        {card.pausedForNumber && <p className="text-[11px] font-bold text-tm-red">Paused: no contact number</p>}
      </div>

      {/* The paid tutors, newest first */}
      <ul className="space-y-2">
        {card.tutors.map((t) => (
          <TutorLine key={t.id} tutor={t} checked={selected.has(t.id)} onToggle={() => toggle(t.id)} canSelect={!readOnly} canOpenMembers={canOpenMembers} />
        ))}
      </ul>

      {state.lastForward && <p className="text-[11px] font-semibold text-slate-700">{forwardedLine(state.lastForward, nowMs)}</p>}
      {state.lastOutcome && (
        <p className="text-[11px] font-semibold text-tm-green-deep">
          {OUTCOME_LABEL[state.lastOutcome.outcome]}
          {outcomeTutorName ? `: ${outcomeTutorName}` : ''}
          {state.lastOutcome.note ? ` — ${state.lastOutcome.note}` : ''}
          <span className="font-normal text-gray-600"> · {formatDate(state.lastOutcome.at)}{state.lastOutcome.staffName ? ` by ${state.lastOutcome.staffName}` : ''}</span>
        </p>
      )}

      {/* No number on the tuition: "Add parent number" replaces WhatsApp / Call. */}
      {!readOnly && !card.parent.msisdn && card.parent.teamPosted && (
        <div className="mt-auto space-y-1">
          <p className="text-[11px] font-bold text-slate-700">Add parent number</p>
          <AddParentNumber jobId={card.jobId} offerResume />
        </div>
      )}
      {!readOnly && !card.parent.msisdn && !card.parent.teamPosted && (
        <p className="mt-auto text-[11px] text-gray-600">This parent has no verified mobile yet, so there is nobody to forward to.</p>
      )}

      {!readOnly && !!card.parent.msisdn && (
        <div className="mt-auto space-y-2">
          <div className="flex gap-2">
            {waHref ? (
              <a href={waHref} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-tm-green-deep text-white`}>
                <MessageCircle size={14} aria-hidden /> WhatsApp parent
              </a>
            ) : (
              <span className={`${BTN} border border-gray-200 text-gray-500`}>{card.parent.msisdn ? 'Tick a tutor' : 'No WhatsApp number'}</span>
            )}
            {telHref && (
              <a href={telHref} className={`${BTN} border border-tm-navy text-tm-navy`}>
                <Phone size={14} aria-hidden /> Call parent
              </a>
            )}
          </div>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => void markForwarded(waHref ? 'whatsapp' : telHref ? 'call' : 'other')} className={`${BTN} w-full bg-tm-navy text-white disabled:opacity-50`}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            Mark as forwarded{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>

          {state.lastForward && (
            <div className="space-y-1.5 rounded-xl border border-gray-200 p-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600">What did the parent say?</p>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeKind | '')} aria-label="Outcome" className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-2 text-[11px]">
                <option value="">Choose an outcome</option>
                {(Object.keys(OUTCOME_LABEL) as OutcomeKind[]).map((k) => (
                  <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>
                ))}
              </select>
              {outcome && OUTCOME_NEEDS_TUTOR[outcome] && (
                <select value={outcomeTutor} onChange={(e) => setOutcomeTutor(e.target.value)} aria-label="Which tutor" className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-2 text-[11px]">
                  <option value="">Which tutor?</option>
                  {card.tutors.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              {outcome && (
                <>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" aria-label="Note" className="min-h-[40px] w-full rounded-lg border border-gray-200 px-2 text-[11px] outline-none focus:border-tm-navy" />
                  <button type="button" disabled={busy} onClick={() => void saveOutcome()} className={`${BTN} w-full border border-tm-green-deep text-tm-green-deep disabled:opacity-50`}>
                    Save outcome
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function TutorLine({ tutor, checked, onToggle, canSelect, canOpenMembers }: { tutor: ForwardTutor; checked: boolean; onToggle: () => void; canSelect: boolean; canOpenMembers: boolean }) {
  const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
  return (
    <li className="flex items-start gap-2 rounded-xl border border-gray-100 p-2">
      {canSelect && (
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Include ${tutor.name}`} className="mt-2 h-5 w-5 shrink-0 accent-tm-navy" />
      )}
      <Avatar name={tutor.name} src={tutor.avatarUrl} gender={tutor.gender} className="h-10 w-10" px={40} decorative />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-slate-800">{tutor.name}</span>
          <BadgeRow badges={tutor.badges} size="sm" />
        </div>
        <p className="text-[11px] text-slate-700">
          {[tutor.subjects.slice(0, 3).join(', ') + (tutor.subjects.length > 3 ? ` +${tutor.subjects.length - 3} more` : ''), tutor.experienceYears != null ? `${tutor.experienceYears} yr experience` : '', place]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="text-[11px] text-gray-600">
          <span className={`font-bold ${tutor.kind === 'applied' ? 'text-tm-green-deep' : 'text-tm-navy'}`}>{tutor.kind === 'applied' ? 'Applied' : 'Viewed number'}</span>
          {' · '}
          <TimeAgo iso={tutor.at} />
          {tutor.alreadySent && <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">already sent</span>}
        </p>
        <p className="flex flex-wrap gap-x-3 text-[11px] font-bold">
          {tutor.profileUrl && (
            <a href={tutor.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[28px] items-center gap-1 text-tm-navy hover:underline">
              Public profile <ExternalLink size={11} aria-hidden />
            </a>
          )}
          {canOpenMembers && (
            <Link href={`/admin/tutors/${tutor.id}`} className="inline-flex min-h-[28px] items-center text-tm-navy hover:underline">
              Admin page
            </Link>
          )}
        </p>
      </div>
    </li>
  )
}
