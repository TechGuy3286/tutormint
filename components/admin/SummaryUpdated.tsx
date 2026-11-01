'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'

// "Updated 3 min ago · Refresh" (owner, 1 Nov 2026). The Overview figures and
// the sidebar badges are pre-calculated (lib/adminSummary); Refresh works them
// out now and reloads the page. The label comes from the server.
export default function SummaryUpdated({ label }: { label: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/summary/refresh', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) toast.error(data.error ?? 'That did not go through. Please try again.')
      else {
        toast.success('Figures updated.')
        router.refresh()
      }
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500" data-summary-updated="">
      <span>{label}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-1.5 font-bold text-tm-navy hover:underline disabled:opacity-60"
      >
        <RefreshCw aria-hidden size={12} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Working it out…' : 'Refresh'}
      </button>
    </p>
  )
}
