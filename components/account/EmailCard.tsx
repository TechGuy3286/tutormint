'use client'

import { useEffect, useState } from 'react'
import { AtSign, CheckCircle2, Clock } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { isSyntheticEmail, looksLikeEmail } from '@/lib/phone'
import { useToast } from '@/components/ui/Toast'

// Add or change the account email (PR29 §4), for tutor and parent Settings.
//
// A mobile-signup account has a synthetic address delivered to nowhere; this is
// where they add a real one so we can send receipts and reminders. It is
// confirmed by a LINK before it is used for sending (§4.3): submitting sends a
// Supabase confirmation link to the new address, and it shows "Email not
// confirmed" until the link is clicked. Self-contained — reads the auth user
// itself and posts to /api/account/email — so it drops into either settings
// page with one line.

export default function EmailCard() {
  const supabase = createClient()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<string | null>(null) // real, confirmed
  const [pending, setPending] = useState<string | null>(null) // awaiting confirmation
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let live = true
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!live) return
        const email = user?.email ?? null
        setCurrent(email && !isSyntheticEmail(email) ? email : null)
        // Supabase exposes an unconfirmed change as new_email.
        const ne = (user as { new_email?: string | null } | null)?.new_email ?? null
        setPending(ne && ne.trim() ? ne : null)
      })
      .catch(() => {})
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [supabase])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const email = value.trim().toLowerCase()
    if (!looksLikeEmail(email)) {
      toast.error('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/account/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Could not send the confirmation link.')
        return
      }
      setPending(email)
      setEditing(false)
      setValue('')
      toast.success('Confirmation link sent. Check your inbox.')
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = 'block text-xs font-bold text-tm-navy'
  const input =
    'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-tm-navy placeholder:text-gray-500 focus:border-tm-navy focus:outline-none'

  return (
    <section id="email" className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 scroll-mt-24">
      <div className="flex items-center gap-1.5">
        <AtSign aria-hidden size={16} className="text-tm-navy" />
        <h2 className="text-sm font-black text-tm-navy">Email address</h2>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : (
        <>
          {current && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-tm-green-deep">
              <CheckCircle2 aria-hidden size={14} /> {current} — confirmed
            </p>
          )}

          {pending && (
            <p className="flex items-start gap-1.5 rounded-xl bg-tm-tint-gold p-2.5 text-[11px] font-semibold text-tm-gold-ink">
              <Clock aria-hidden size={13} className="mt-px shrink-0" />
              Email not confirmed — we sent a confirmation link to {pending}. Click it to finish. We
              only send emails to a confirmed address.
            </p>
          )}

          {!current && !pending && (
            <p className="text-xs text-gray-600">
              Add an email so we can send you receipts and reminders. Your mobile number stays your
              login and is what makes you searchable.
            </p>
          )}

          {editing || (!current && !pending) ? (
            <form onSubmit={submit} className="space-y-2">
              <label htmlFor="account-email" className={label}>
                {current ? 'New email address' : 'Your email address'}
              </label>
              <input
                id="account-email"
                type="email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="you@example.com"
                className={input}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
                >
                  {busy ? 'Sending…' : 'Send confirmation link'}
                </button>
                {(current || pending) && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false)
                      setValue('')
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex min-h-[40px] items-center rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy"
            >
              {current ? 'Change email' : 'Add a different email'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
