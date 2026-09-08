'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'

// Resend the signup confirmation link (owner, Part 8). The account exists,
// unconfirmed; this asks Supabase to send the link again.
//
// Supabase enforces a 60-SECOND MINIMUM between confirmation emails per user,
// and the initial signUp already sent one — so a resend a few seconds later is
// refused with "for security purposes… after N seconds". That MUST NOT fail
// silently: the seconds are parsed out and shown as a live countdown, and after
// a successful send we start a 60s cooldown ourselves so the next press is not
// a wasted round trip. No oracle concern here (unlike /forgot-password): this is
// the address the member just typed into their own signup, not a probe.

export default function ResendEmail({ address }: { address: string }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function resend() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const supabase = createClient()
      const { error: err } = await supabase.auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
      })
      if (err) {
        // "For security purposes, you can only request this after N seconds."
        const wait = /(\d+)\s*second/i.exec(err.message)?.[1]
        if (wait) {
          setCooldown(Number(wait))
          setError(`Please wait ${wait}s before requesting another email.`)
        } else {
          setError(err.message)
        }
        return
      }
      setNotice('Sent. Check your inbox again — and your spam folder.')
      setCooldown(60)
    } catch {
      setError('Could not resend right now. Please try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={resend}
        disabled={busy || cooldown > 0}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-50"
      >
        <Mail aria-hidden size={14} />
        {busy ? 'Resending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend the email'}
      </button>
      {notice && <p className="text-[11px] font-bold text-tm-green-deep">{notice}</p>}
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
    </div>
  )
}
