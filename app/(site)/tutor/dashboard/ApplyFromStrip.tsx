'use client'

import Link from 'next/link'
import { Send, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'

// Apply, from the "matching you this week" strip on a tutor's dashboard.
//
// `listed` here means VERIFIED — the one-time fee is paid (PR16 §1.2). Applying
// is gated on the fee, not on visibility, so an unverified tutor (who is already
// visible in browse) gets a "Verify to apply" link into the verify step rather
// than an Apply button. A verified tutor gets the real button.

export default function ApplyFromStrip({ jobId, listed }: { jobId: string; listed: boolean }) {
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!listed) {
    return (
      <Link
        href="/tutor/complete-profile?step=verify"
        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-tm-red hover:underline"
      >
        Verify to apply
        <ArrowRight aria-hidden size={12} />
      </Link>
    )
  }

  const apply = async () => {
    setState('busy')
    setError(null)
    const r = await postGated('/api/applications', { jobId }, upgradeSheet?.showGate)
    if (r.ok) {
      toast.success('Application sent.')
      return setState('done')
    }
    if (!r.gated) setError(r.error)
    setState('idle')
  }

  if (state === 'done') {
    return <span className="shrink-0 text-[11px] font-bold text-tm-green-deep">Applied</span>
  }

  return (
    <span className="shrink-0 text-right">
      <button
        type="button"
        onClick={apply}
        disabled={state === 'busy'}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-red px-3 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
      >
        <Send aria-hidden size={13} />
        Apply
      </button>
      {error && <span className="block pt-1 text-[10px] text-tm-red">{error}</span>}
    </span>
  )
}
