'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'

// "Mark all read" on the full notifications page. Zeroes the unread count (the
// same route the bell uses) and refreshes so the list and the header count both
// settle. Rendered only when there is something unread.

export default function MarkAllReadButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/notifications/read-all', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!r.ok) throw new Error(String(r.status))
      toast.success('All notifications marked read.')
      router.refresh()
    } catch {
      toast.error('Could not mark all read.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-60"
    >
      {busy ? <Loader2 aria-hidden size={14} className="animate-spin" /> : <CheckCheck aria-hidden size={14} />}
      Mark all read
    </button>
  )
}
