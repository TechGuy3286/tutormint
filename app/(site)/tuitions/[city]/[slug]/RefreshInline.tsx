'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import { adminFetch } from '@/components/admin/adminFetch'

// Refresh, on the tuition's own page (owner, 6 Oct 2026, item 16): the poster
// through /api/parent/jobs/refresh, an admin through the admin action route —
// the same lib/tuitionMerge.refreshTuition behind both (fresh 7 days, top of
// Browse, same URL, Google told, once every 3 days).

export default function RefreshInline({ jobId, admin = false }: { jobId: string; admin?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setBusy(true)
    try {
      if (admin) {
        const r = await adminFetch<{ error?: string }>('/api/admin/jobs/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, action: 'refresh' }),
        })
        if (!r.ok) throw new Error(r.data?.error ?? 'Could not refresh this tuition. Please try again.')
      } else {
        const res = await fetch('/api/parent/jobs/refresh', {
          signal: submitSignal(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not refresh this tuition. Please try again.')
      }
      toast.success('Refreshed. This tuition is at the top of the list again for 15 more days.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh this tuition. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3">
      <p className="text-[11px] text-slate-700">
        Refresh moves this tuition to the top of the list for 15 more days. Once every 3 days.
      </p>
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
      >
        <RefreshCw aria-hidden size={14} />
        {busy ? 'Working…' : 'Refresh'}
      </button>
    </div>
  )
}
