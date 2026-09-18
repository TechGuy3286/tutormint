'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'

// The poster's inline Resume, on their own paused tuition page (PR28 §5). Reuses
// /api/parent/jobs/resume — the same route the dashboard uses — so the resume
// logic (ownership check, fresh 15-day clock) is not duplicated.

export default function ResumeInline({ jobId }: { jobId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const resume = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/parent/jobs/resume', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not resume the tuition.')
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
      {busy ? 'Resuming…' : 'Resume this tuition'}
    </button>
  )
}
