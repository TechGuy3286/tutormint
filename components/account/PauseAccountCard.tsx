'use client'

import { useState } from 'react'
import { PauseCircle } from 'lucide-react'

import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { pauseConfirmText } from '@/lib/selfPauseCore'

// "Pause my account" (owner, 8 Oct 2026), in Settings → Account for tutors and
// parents. One button, one confirmation in English with Urdu; on Pause the
// server hides the account, pauses a parent's open tuitions, signs every
// device out, and this page goes to the sign-in screen. Signing in again
// brings everything back (lib/selfPause.ts).

export default function PauseAccountCard() {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const pause = async () => {
    let paidPlan = false
    try {
      const r = await fetch('/api/account/pause')
      if (r.ok) paidPlan = !!((await r.json()) as { paidPlan?: boolean }).paidPlan
    } catch {
      /* the plain text is still right */
    }
    const text = pauseConfirmText({ paidPlan })
    const ok = await confirm({
      title: 'Pause your account?',
      body: `${text.en}\n\n${text.ur}`,
      confirmLabel: 'Pause',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await fetch('/api/account/pause', { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toast.error(j.error ?? 'That did not save. Please try again.')
        setBusy(false)
        return
      }
      // Signed out on every device; a full load so nothing signed-in lingers.
      window.location.assign('/login?paused=1')
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-700">
        Hide your profile and sign out on every device. Sign in any time to bring it back. Nothing is deleted.
      </p>
      <p lang="ur" dir="rtl" className="text-[11px] leading-relaxed text-gray-500">
        اپنی پروفائل چھپائیں اور ہر ڈیوائس سے سائن آؤٹ ہو جائیں۔ واپس لانے کے لیے کسی بھی وقت سائن اِن کریں۔ کچھ بھی حذف نہیں ہوتا۔
      </p>
      <button
        type="button"
        onClick={() => void pause()}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-tm-red/40 bg-white px-6 text-xs font-extrabold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
      >
        <PauseCircle aria-hidden size={15} /> {busy ? 'Pausing…' : 'Pause my account'}
      </button>
    </div>
  )
}
