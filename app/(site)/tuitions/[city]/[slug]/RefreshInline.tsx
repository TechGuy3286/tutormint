'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Clock } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import { adminFetch } from '@/components/admin/adminFetch'
import { KEEP_OPEN_LABEL, MOVE_TO_TOP_LABEL, REFRESH_BOX_TEXT, moveToTopState } from '@/lib/posterToolsCore'

// The poster's "Move to top" and "Keep it open", on the tuition's own page
// (owner, 2 Nov 2026). Both run the same refresh (lib/tuitionMerge
// refreshTuition: fresh live days, top of Browse, same URL, Google told, once
// every 3 days) — the poster through /api/parent/jobs/refresh, staff on a
// team-posted tuition through the admin action route. When the 3 days are not
// up, the button is greyed out with the date it works again, instead of an
// error after tapping.

export default function RefreshInline({
  jobId,
  admin = false,
  nextAt = null,
  keepOpen = false,
  notice,
}: {
  jobId: string
  admin?: boolean
  nextAt?: number | null
  keepOpen?: boolean
  notice?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const state = moveToTopState(nextAt, Date.now(), keepOpen)

  const refresh = async () => {
    if (!state.enabled) return
    setBusy(true)
    try {
      if (admin) {
        const r = await adminFetch<{ error?: string }>('/api/admin/jobs/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, action: 'refresh' }),
        })
        if (!r.ok) throw new Error(r.data?.error ?? 'That did not go through. Please try again.')
      } else {
        const res = await fetch('/api/parent/jobs/refresh', {
          signal: submitSignal(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'That did not go through. Please try again.')
      }
      toast.success(keepOpen ? 'Done. Your tuition stays open for longer.' : 'Done. Your tuition is at the top again.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = keepOpen ? KEEP_OPEN_LABEL : MOVE_TO_TOP_LABEL
  const Icon = keepOpen ? Clock : ArrowUp
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3">
      <p className="min-w-0 flex-1 text-xs text-slate-700">{notice ?? REFRESH_BOX_TEXT}</p>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={refresh}
          disabled={busy || !state.enabled}
          aria-disabled={!state.enabled}
          className={
            state.enabled
              ? 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy active:scale-[0.98] disabled:opacity-60'
              : 'inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-200 px-4 text-xs font-bold text-slate-700'
          }
        >
          <Icon aria-hidden size={14} />
          {busy ? 'Working…' : label}
        </button>
        {state.note && <p className="text-[11px] text-slate-700">{state.note}</p>}
      </div>
    </div>
  )
}
