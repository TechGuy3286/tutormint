'use client'

import { planEndsLine } from '@/lib/upgradePlanCore'
import LooksFineButton from '@/components/admin/LooksFineButton'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, FileCheck2, MoreHorizontal, RotateCcw, X } from 'lucide-react'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import { adminFetch } from '@/components/admin/adminFetch'
import NotInterestedButton from '@/components/admin/NotInterestedButton'
import PaidWelcomeActions from '@/components/admin/PaidWelcomeActions'
import PipeContactButtons, { type PipeContactLinks } from '@/components/admin/PipeContactButtons'
import { useAdminReadOnly, useDocDecider } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatDayMonth } from '@/lib/datetime'
import type { BadgeName } from '@/lib/planBadges'
import { niChip, niMenuAllowed, type NiMark } from '@/lib/notInterestedCore'
import { isFollowStage } from '@/lib/tutorPipelineCore'
import { TRIED_TO_PAY_LABEL } from '@/lib/paymentAttemptsCore'
import {
  blankLine,
  lastOutcomeLine,
  NO_MOBILE_LINE,
  pipeDetailLine,
  pipeMetaLine,
  REUPLOADED_LABEL,
  type PipeCard,
} from '@/lib/tutorPipelineCardCore'
import { BLANK_REJECT_LABEL, blankRejectReason, type BlankItem } from '@/lib/photoBlankCore'
import { usePipelineMove, type Moved } from '@/components/admin/PipelineMoves'

// People → Tutors — the COMPACT card (owner, 15 Nov 2026; phone first). The
// whole card opens the member page; on it:
//   name + badges, the ⋯ menu ("Not interested");
//   one meta line   "Multan · joined 8 Nov · 94%";
//   one detail line what is missing / rejected / waiting, or "Approved 3 days ago"
//                   (never the stage itself — that is the chip staff picked);
//   one outcome line "11 Nov · WhatsApp by Alee · Follow-up 2 due";
//   the ONE due action (WhatsApp, or a voice note) plus Call.
// Waiting cards get Review; Paid cards the welcome. A photo that looks blank
// shows a red flag with a one-tap "Reject — photo unclear" (the existing
// rejection flow; never automatic) and "Looks fine".

export type PipeLinks = PipeContactLinks

export type PipeCardMember = {
  name: string
  avatarUrl: string | null
  gender?: string | null
  city: string | null
  joinedAt: string | null
  completion: number
  badges: BadgeName[]
}

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'
const BLANK_NAME: Record<BlankItem, string> = { photo: 'Profile photo', selfie: 'Selfie', cnic: 'CNIC' }

const TONE: Record<PipeCard['stage'], string> = {
  rejected: 'text-tm-red',
  approved: 'text-tm-green-deep',
  paid: 'text-tm-green-deep',
  missing: 'text-tm-gold-ink',
  waiting: 'text-tm-gold-ink',
}

export default function PipelineCardBody({
  memberId,
  pipe,
  links,
  m,
  reviewHref,
  extra,
}: {
  memberId: string
  pipe: PipeCard
  links: PipeLinks
  m: PipeCardMember
  reviewHref: string | null
  /** A possible-duplicate line and the like, under the outcome line. */
  extra?: ReactNode
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const decider = useDocDecider()
  const move = usePipelineMove()
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => Date.now())

  // The one-tap rejection of a blank photo — the SAME route and reasons as the
  // Review card; the server decides who may.
  const rejectBlank = async (item: BlankItem) => {
    if (busy) return
    const yes = await confirm({
      title: `Reject the ${item === 'cnic' ? 'CNIC' : BLANK_NAME[item].toLowerCase()}?`,
      body: `The tutor is told: "${blankRejectReason(item)}" and asked to upload a new one.`,
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    move.begin(memberId, !!move.view?.stage && move.view.stage !== 'all')
    const { ok, data } = await adminFetch<{ error?: string; moved?: Moved }>('/api/admin/tutors/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId: memberId, item: item === 'photo' ? 'profile_pic' : item, decision: 'reject', reason: blankRejectReason(item), nameChecked: false }),
    })
    setBusy(false)
    if (!ok) {
      move.fail(memberId)
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    move.done(memberId, data?.moved)
    toast.success('Rejected. The tutor was notified.')
    router.refresh()
  }

  const follow = pipe.follow
  const followable = isFollowStage(pipe.stage) && !pipe.notInterested
  const due = followable && pipe.section === 'not'
  const blank = blankLine(pipe)
  const pending = pipe.pending ?? []
  // Backend Support may decide only a waiting photo or selfie; the Owner any.
  const mayReject = (item: BlankItem) => !readOnly && (decider === 'owner' || (decider === 'staff' && pending.includes(BLANK_NAME[item])))
  const detail = pipeDetailLine(pipe, now)
  const outcome = followable && !pipe.noMobile ? lastOutcomeLine(pipe, formatDayMonth, now) : null
  const contact = !readOnly && followable && !pipe.noMobile && follow && isFollowStage(pipe.stage)

  return (
    <div className="relative flex h-full flex-col gap-2 text-[11px]" data-pipe-stage={pipe.stage} data-pipe-card="">
      {/* The whole card opens the member page; buttons sit above the link. */}
      <Link href={`/admin/users/${memberId}`} aria-label={`Open ${m.name}`} className="absolute inset-0 z-0 rounded-2xl" data-card-link="" />
      <div className="pointer-events-none relative z-10 flex flex-col gap-1.5 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <div className="flex items-start gap-2.5">
          <Avatar name={m.name} src={m.avatarUrl} gender={m.gender} decorative className="h-10 w-10 shrink-0 text-xs" px={40} />
          <div className="min-w-0 flex-1">
            <p className="flex min-h-[20px] min-w-0 items-center gap-1.5" data-name-row="">
              <span className="min-w-0 truncate text-sm font-black text-tm-navy">{m.name}</span>
              {m.badges.length > 0 && <BadgeRow badges={m.badges} size="sm" showUrdu={false} className="shrink-0" nowrap />}
            </p>
            <p className="truncate text-gray-600" data-meta-line="">
              {pipeMetaLine({ city: m.city, joinedAt: m.joinedAt, completion: pipe.completion ?? m.completion }, formatDayMonth)}
            </p>
          </div>
          <PipelineMoreMenu memberId={memberId} pipe={pipe} />
        </div>

        {/* "Selfie checked" is not on People cards (owner, 15 Nov 2026) — it
            stays on the member page and the tutor's own dashboard. */}
        {(pipe.reuploaded || (pipe.stage === 'approved' && pipe.triedToPay)) && (
          <p className="flex flex-wrap gap-1">
            {pipe.reuploaded && (
              <span data-reuploaded="" className="inline-flex items-center gap-1 rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
                <RotateCcw aria-hidden size={10} /> {REUPLOADED_LABEL}
              </span>
            )}
            {pipe.stage === 'approved' && pipe.triedToPay && (
              <span data-tried-to-pay="" className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">
                {TRIED_TO_PAY_LABEL}
              </span>
            )}
          </p>
        )}
        {detail && (
          <p data-detail-line="" className={`break-words font-semibold ${TONE[pipe.stage]}`}>
            {detail}
          </p>
        )}
        {outcome && (
          <p data-outcome-line="" className={`break-words font-semibold ${due ? 'text-tm-red' : 'text-slate-700'}`}>
            {outcome}
          </p>
        )}
        {pipe.noMobile && <p className="font-semibold text-gray-600">{NO_MOBILE_LINE}</p>}
        {pipe.notInterested && <NotInterestedChip mark={pipe.niMark ?? null} />}
        {extra}

        {blank && (
          <div className="space-y-1 rounded-lg border border-tm-red/40 bg-tm-tint-red px-2 py-1.5" data-blank-flag="">
            <p className="flex items-center gap-1 font-bold text-tm-red">
              <AlertTriangle aria-hidden size={12} /> {blank}
            </p>
            {(pipe.blank ?? []).filter(mayReject).map((item) => (
              <button
                key={item}
                type="button"
                disabled={busy}
                onClick={() => void rejectBlank(item)}
                className="inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-lg border border-tm-red bg-white px-2 font-bold text-tm-red disabled:opacity-50"
              >
                <X aria-hidden size={12} /> {BLANK_REJECT_LABEL}
                {(pipe.blank ?? []).length > 1 ? ` (${BLANK_NAME[item]})` : ''}
              </button>
            ))}
            {!readOnly &&
              (pipe.blank ?? []).map((item) => (
                <LooksFineButton key={`fine-${item}`} memberId={memberId} item={item} label={(pipe.blank ?? []).length > 1 ? `Looks fine (${BLANK_NAME[item]})` : undefined} />
              ))}
          </div>
        )}
        {pipe.stage === 'paid' && planEndsLine(pipe.plan) && (
          <p data-plan-line="" className="rounded-lg bg-tm-tint-navy px-2 py-1 font-bold text-tm-navy">
            {planEndsLine(pipe.plan)}
          </p>
        )}
        {pipe.stage === 'paid' && <PaidWelcomeActions memberId={memberId} welcome={pipe.welcome} badge={pipe.badge} />}

        {contact && follow && (
          <div className="flex flex-wrap gap-2 pt-0.5" data-pipe-actions="">
            <PipeContactButtons
              memberId={memberId}
              stage={pipe.stage as 'missing' | 'rejected' | 'approved'}
              nextKind={follow.nextKind}
              links={links}
              from="card"
              btnClass={BTN}
              // Only the ONE due action, plus Call (owner, 15 Nov 2026).
              showWhatsApp={due}
              showVoice={due}
            />
          </div>
        )}
        {pipe.stage === 'waiting' && reviewHref && (
          <Link href={reviewHref} className={`${BTN} bg-tm-red text-white hover:bg-tm-red-hover`}>
            <FileCheck2 aria-hidden size={13} /> Review
          </Link>
        )}
      </div>
    </div>
  )
}

/** The card's small "⋯" menu: "Not interested" and its Undo (owner, 9 Nov 2026;
 *  every stage but Paid since 16 Nov 2026 — niMenuAllowed). */
export function PipelineMoreMenu({ memberId, pipe }: { memberId: string; pipe: PipeCard }) {
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      // The Not interested form is portalled to <body>; a click in it keeps the menu.
      if ((e.target as Element | null)?.closest?.('[data-ni-overlay]')) return
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (readOnly || !niMenuAllowed(pipe.stage, pipe.notInterested)) return null
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-gray-500 hover:border-gray-200 hover:text-tm-navy"
      >
        <MoreHorizontal aria-hidden size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 min-w-[190px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <NotInterestedButton memberId={memberId} marked={pipe.notInterested} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** The grey chip on a marked card (owner, 11 Nov 2026): reason and date, then
 *  the note and who marked it. */
export function NotInterestedChip({ mark }: { mark: NiMark | null }) {
  return (
    <div data-ni-chip="" className="space-y-0.5">
      <span className="inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-slate-800">
        {mark ? niChip(mark, formatDate) : 'Not interested'}
      </span>
      {mark?.note && <p className="break-words text-[11px] text-slate-700 [overflow-wrap:anywhere]">Note: {mark.note}</p>}
      {mark?.by && <p className="text-[11px] text-gray-600">Marked by {mark.by}</p>}
    </div>
  )
}
