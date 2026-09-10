'use client'

import Link from 'next/link'
import { Send, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'

// Apply, from the "matching you this week" strip on a free tutor's dashboard.
//
// For a LISTED tutor the button is real and the refusal is the upgrade sheet.
//
// A free tutor is NOT listed — since 10 Sep 2026 listing needs a plan, not 100%
// completion (owner) — so the block is the PLAN, which is exactly what the
// 199 funnel is steering them toward. Instead of an Apply button they get a
// plain "Get listed to apply" link into packages, so the plan appears on their
// own tap (this is a signed-in dashboard, where the price is allowed to show).

export default function ApplyFromStrip({ jobId, listed }: { jobId: string; listed: boolean }) {
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!listed) {
    return (
      <Link
        href="/tutor/packages?plan=verified"
        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-tm-red hover:underline"
      >
        Get listed to apply
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
