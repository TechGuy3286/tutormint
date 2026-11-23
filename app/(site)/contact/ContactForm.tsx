'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { CONTACT_FAILED, CONTACT_MESSAGE_MAX, CONTACT_NAME_MAX, HONEYPOT_FIELD } from '@/lib/contactFormCore'

// The /contact form (PR-20 Part A): name, mobile or email, message. The hidden
// "website" box is the honeypot — people never see or fill it. Nothing typed
// here is kept in the browser.

export default function ContactForm() {
  const toast = useToast()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, contact, message, [HONEYPOT_FIELD]: website }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string }
      if (!res.ok || !j.ok) {
        setError(j.error ?? CONTACT_FAILED)
        toast.error(j.error ?? CONTACT_FAILED)
        return
      }
      setSent(j.message ?? 'Thank you. Your message has been sent.')
      toast.success('Message sent.')
      setName('')
      setContact('')
      setMessage('')
    } catch {
      setError(CONTACT_FAILED)
      toast.error(CONTACT_FAILED)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-2xl bg-tm-tint-green p-4 text-sm font-semibold text-tm-green-deep">
        <CheckCircle2 aria-hidden size={18} className="mt-0.5 shrink-0" />
        <p>{sent}</p>
      </div>
    )
  }

  const input = 'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-tm-navy outline-none focus:border-tm-navy'
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="contact-name" className="mb-1 block text-xs font-bold text-tm-navy">
          Your name
        </label>
        <input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={CONTACT_NAME_MAX} autoComplete="name" required className={input} />
      </div>
      <div>
        <label htmlFor="contact-reach" className="mb-1 block text-xs font-bold text-tm-navy">
          Mobile number or email
        </label>
        <input id="contact-reach" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} autoComplete="tel" placeholder="03XX XXXXXXX or you@example.com" required className={input} />
      </div>
      <div>
        <label htmlFor="contact-message" className="mb-1 block text-xs font-bold text-tm-navy">
          Message
        </label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={CONTACT_MESSAGE_MAX}
          rows={5}
          required
          className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-tm-navy outline-none focus:border-tm-navy"
        />
      </div>
      {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-5 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-300"
      >
        {busy ? <Loader2 aria-hidden size={15} className="animate-spin" /> : <Send aria-hidden size={15} />}
        {busy ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
