'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'

// The gentle reminder on the dashboard while an email is waiting for its
// confirmation link (owner, 13 Oct 2026). It blocks nothing — the tutor can
// finish onboarding and pay — and goes away once the link is clicked.

export default function EmailConfirmReminder({ email }: { email: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const resend = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/account/email/resend', { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { error?: string; alreadyConfirmed?: boolean }
      if (!res.ok) {
        toast.error(j.error ?? 'We could not send the email just now. Please try again in a few minutes.')
        return
      }
      setSent(true)
      toast.success(j.alreadyConfirmed ? 'Your email is already confirmed.' : `Email sent to ${email}.`)
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-tm-navy sm:p-4">
      <Mail aria-hidden size={18} className="shrink-0" />
      <p className="min-w-0 flex-1 break-words text-xs font-semibold leading-relaxed">
        Please confirm your email <span className="font-black">{email}</span>. We sent you a link — open it when you can. You can keep using your account in the meantime.
      </p>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center rounded-xl border border-tm-navy bg-white px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-60"
      >
        {busy ? 'Sending…' : sent ? 'Send again' : 'Resend email'}
      </button>
    </section>
  )
}
