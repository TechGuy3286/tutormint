'use client'

import Link from 'next/link'
import { Send, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'

// Apply, from the "matching you this week" strip on a free tutor's dashboard.
//
// For a LISTED free tutor the button is real and the refusal is the upgrade
// sheet -- which is the whole point of the strip: their only block is the plan,
// and pressing this IS reaching for it, so the price appears on their own tap.
//
// For an UNLISTED tutor the block is COMPLETION, not a plan. Applying could not
// reach anyone, and pitching a price (even the completion gate's "Buy anyway")
// is the wrong thing to put in front of someone whose profile is not finished.
// So instead of an Apply button they get a plain, honest "Finish profile to
// apply" link — the surface says why, with no upgrade and no price (owner,
// 9 Sep 2026).

export default function ApplyFromStrip({ jobId, listed }: { jobId: string; listed: boolean }) {
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!listed) {
    return (
      <Link
        href="/tutor/complete-profile"
        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-tm-red hover:underline"
      >
        Finish profile to apply
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
