'use client'

import { Clock, Lock, MessageCircle, Unlock } from 'lucide-react'
import { supportWhatsappHref } from '@/lib/errorMessages'
import { LOCKED_MESSAGE_EN, LOCKED_MESSAGE_UR, type LockView } from '@/lib/docLockCore'

// What a member sees where the upload button was, once a document is approved
// (owner, 9 Oct 2026). English with a short Urdu line under it, the site's style.
//   locked   — Approved ✓ Locked, contact support on WhatsApp.
//   waiting  — a new upload was sent and waits for our team.
//   unlocked — staff unlocked it: one new upload allowed (a small note above
//              the upload control, which stays).

const WAITING_EN = 'New upload sent. Our team will check it. Your approved document stays on record until then.'
const WAITING_UR = 'نئی تصویر بھیج دی گئی ہے۔ ہماری ٹیم اسے دیکھے گی۔ تب تک آپ کی منظور شدہ دستاویز ریکارڈ پر رہے گی۔'
const UNLOCKED_EN = 'Unlocked by our team: you can upload one new photo.'
const UNLOCKED_UR = 'ہماری ٹیم نے کھول دیا ہے: آپ ایک نئی تصویر اپلوڈ کر سکتے ہیں۔'

export default function DocLockNotice({ view, className = '' }: { view: LockView; className?: string }) {
  if (view === 'open') return null
  if (view === 'unlocked') {
    return (
      <div className={`rounded-xl bg-tm-tint-navy p-2.5 ${className}`}>
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-tm-navy">
          <Unlock aria-hidden size={13} className="mt-px shrink-0" />
          {UNLOCKED_EN}
        </p>
        <p lang="ur" dir="rtl" className="mt-0.5 text-[11px] text-tm-navy">{UNLOCKED_UR}</p>
      </div>
    )
  }
  if (view === 'waiting') {
    return (
      <div className={`rounded-xl bg-tm-tint-gold p-2.5 ${className}`}>
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-tm-gold-ink">
          <Clock aria-hidden size={13} className="mt-px shrink-0" />
          {WAITING_EN}
        </p>
        <p lang="ur" dir="rtl" className="mt-0.5 text-[11px] text-tm-gold-ink">{WAITING_UR}</p>
      </div>
    )
  }
  return (
    <div className={`space-y-1.5 rounded-xl bg-tm-tint-green p-2.5 ${className}`}>
      <p className="flex items-start gap-1.5 text-[11px] font-semibold text-tm-green-deep">
        <Lock aria-hidden size={13} className="mt-px shrink-0" />
        {LOCKED_MESSAGE_EN}
      </p>
      <p lang="ur" dir="rtl" className="text-[11px] text-tm-green-deep">{LOCKED_MESSAGE_UR}</p>
      <a
        href={supportWhatsappHref()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-tm-green-deep/30 bg-white px-3 text-[11px] font-bold text-tm-green-deep"
      >
        <MessageCircle aria-hidden size={13} /> WhatsApp 0321 5872222
      </a>
    </div>
  )
}

/** The most restrictive of several part views — one notice for a CNIC's two sides. */
export function combinedView(views: LockView[]): LockView {
  if (views.includes('unlocked')) return 'unlocked'
  if (views.includes('waiting')) return 'waiting'
  if (views.includes('locked')) return 'locked'
  return 'open'
}
