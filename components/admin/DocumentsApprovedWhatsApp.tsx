'use client'

import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// "Send WhatsApp" once a tutor's CNIC, profile photo and selfie are all
// approved (owner, 15 Oct 2026). Opens WhatsApp (wa.me) to the tutor with the
// documents_approved message pre-filled — the "pay the Verification Fee"
// version or the "your profile is live" version, picked on the server. Staff
// press send in their own WhatsApp. The click is logged like other WhatsApp
// follow-ups (member_follow_ups, source 'documents', Audit + member timeline).

export default function DocumentsApprovedWhatsApp({ tutorId }: { tutorId: string }) {
  const toast = useToast()
  const [msg, setMsg] = useState<{ href: string | null; templateKey: string; feePaid: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const { ok, data } = await adminFetch<{ href?: string | null; templateKey?: string; feePaid?: boolean; error?: string }>(
        `/api/admin/documents-approved?tutorId=${encodeURIComponent(tutorId)}`,
      )
      if (!live) return
      if (ok && data?.templateKey) setMsg({ href: data.href ?? null, templateKey: data.templateKey, feePaid: !!data.feePaid })
      else setError(data?.error ?? 'Could not prepare the WhatsApp message.')
    })()
    return () => {
      live = false
    }
  }, [tutorId])

  if (error) return <p className="text-[11px] font-semibold text-tm-red">{error}</p>
  if (!msg) return null
  if (!msg.href) {
    return <p className="text-[11px] font-semibold text-gray-500">No WhatsApp or mobile number on file to send the approval message to.</p>
  }

  const log = () => {
    void adminFetch('/api/admin/follow-ups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId: tutorId, channel: 'whatsapp', templateKey: msg.templateKey, source: 'documents' }),
    }).then(({ ok }) => {
      if (ok) toast.success('WhatsApp opened. Logged as a follow-up.')
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3">
      <p className="min-w-0 flex-1 text-[11px] font-bold text-tm-green-deep">
        All documents approved.{' '}
        {msg.feePaid ? 'The message says the profile is live.' : 'The message asks them to pay the Verification Fee.'}
      </p>
      <a
        href={msg.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={log}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-tm-green-deep px-3 text-[11px] font-bold text-white hover:bg-tm-green-deep-hover"
      >
        <MessageCircle size={13} aria-hidden /> Send WhatsApp
      </a>
    </div>
  )
}
