'use client'

import { Send } from 'lucide-react'
import { useState } from 'react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'

// Apply, from the "matching you this week" strip on a free tutor's dashboard.
//
// The button is real and the refusal is the upgrade sheet -- which is the whole
// point of the strip. A disabled button with "Verified only" written on it
// would tell the tutor the same thing while giving them nothing to press, and
// a price printed here would break the rule that the price appears only when
// the tutor reaches for it. Pressing this IS reaching for it.

export default function ApplyFromStrip({ jobId }: { jobId: string }) {
  const upgradeSheet = useUpgradeSheet()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    setState('busy')
    setError(null)
    const r = await postGated('/api/applications', { jobId }, upgradeSheet?.showGate)
    if (r.ok) return setState('done')
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
