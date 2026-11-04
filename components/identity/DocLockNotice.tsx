'use client'

import { Clock, Unlock } from 'lucide-react'
import MemberLockBox from '@/components/account/MemberLockBox'
import { type LockedDoc, type LockView } from '@/lib/docLockCore'

// What a member sees about a document (owner, 4 Nov 2026 — superseding the
// "Approved 🔒" notice of 9 and 17 Oct). English only.
//   locked   — the CNIC only (number and pictures): the support box.
//   waiting  — a new upload was sent and waits for our team; the approved one
//              stays on record (and, for the photo, public) until then.
//   unlocked — staff unlocked the CNIC: one new upload allowed.
// The profile photo and the selfie are never locked.

const WAITING_EN: Record<LockedDoc, string> = {
  cnic: 'New upload sent. Our team will check it. Your approved CNIC stays on record until then.',
  cnic_number: 'New upload sent. Our team will check it. Your approved CNIC stays on record until then.',
  selfie: 'New selfie sent. Our team will check it. Your approved selfie stays on record until then.',
  photo: 'New photo sent. Our team will check it. Parents see your approved photo until then.',
}
const UNLOCKED_EN = 'Unlocked by our team: you can upload one new photo.'

export default function DocLockNotice({
  view,
  doc = 'cnic',
  className = '',
}: {
  view: LockView
  /** Which document this is. */
  doc?: LockedDoc
  className?: string
}) {
  if (view === 'open') return null
  if (view === 'unlocked') {
    return (
      <div className={`rounded-xl bg-tm-tint-navy p-2.5 ${className}`}>
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-tm-navy">
          <Unlock aria-hidden size={13} className="mt-px shrink-0" />
          {UNLOCKED_EN}
        </p>
      </div>
    )
  }
  if (view === 'waiting') {
    return (
      <div className={`rounded-xl bg-tm-tint-gold p-2.5 ${className}`}>
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-tm-gold-ink">
          <Clock aria-hidden size={13} className="mt-px shrink-0" />
          {WAITING_EN[doc]}
        </p>
      </div>
    )
  }
  // Only the CNIC is ever locked.
  return <MemberLockBox field="cnic" className={className} />
}

/** The most restrictive of several part views — one notice for a CNIC's two sides. */
export function combinedView(views: LockView[]): LockView {
  if (views.includes('unlocked')) return 'unlocked'
  if (views.includes('waiting')) return 'waiting'
  if (views.includes('locked')) return 'locked'
  return 'open'
}
