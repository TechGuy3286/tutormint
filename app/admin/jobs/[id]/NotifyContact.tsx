'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'

// "Message parent on WhatsApp" for a seeded tuition. POSTs to the notify route
// (which audits + timelines the action) and opens the returned wa.me link for
// the admin to actually send. Non-destructive, so no confirm — just a toast.
export default function NotifyContact({ jobId }: { jobId: string }) {
  const { success, error } = useToast()
  const [busy, setBusy] = useState(false)

  async function notify() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/notify`, { method: 'POST' })
      const data = (await res.json()) as { error?: string; waHref?: string }
      if (!res.ok) {
        error(data.error ?? 'Could not prepare the message.')
        return
      }
      if (data.waHref) window.open(data.waHref, '_blank', 'noopener,noreferrer')
      success('WhatsApp opened — send the message there to deliver it.')
    } catch {
      error('Could not prepare the message. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={notify}
      disabled={busy}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep-hover disabled:opacity-60"
    >
      <MessageCircle aria-hidden size={14} />
      {busy ? 'Preparing…' : 'Message parent (WhatsApp)'}
    </button>
  )
}
