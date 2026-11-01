'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import { adminFetch } from '@/components/admin/adminFetch'

// The poster's inline Resume, on their own paused tuition page (PR28 §5). Reuses
// /api/parent/jobs/resume — the same route the dashboard uses — so the resume
// logic (ownership check, fresh 20-day clock) is not duplicated.

export default function ResumeInline({ jobId, label = 'Resume this tuition', admin = false }: { jobId: string; label?: string; admin?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const resume = async () => {
    setBusy(true)
    try {
      if (admin) {
        // Staff on a team-posted tuition: the admin action route.
        const r = await adminFetch<{ error?: string }>('/api/admin/jobs/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, action: 'resume' }),
        })
        if (!r.ok) throw new Error(r.data?.error ?? 'Could not resume the tuition.')
      } else {
        const res = await fetch('/api/parent/jobs/resume', {
          signal: submitSignal(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not resume the tuition.')
      }
      toast.success('Resumed. Tutors can see and apply to it again.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resume the tuition.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={resume}
      disabled={busy}
      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-60"
    >
      <Play aria-hidden size={14} className="fill-white" />
      {busy ? 'Resuming…' : label}
    </button>
  )
}
