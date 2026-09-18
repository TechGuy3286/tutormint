'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Handshake } from 'lucide-react'

import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import type { Gate } from '@/lib/gate'

// The Hire button on a shortlisted tutor card and a tutor's public profile, for
// signed-in parents (PR25 §2).
//
//   * A tutor this parent has already hired shows a static "Hired" chip, not a
//     button (§2.3).
//   * A parent WITHOUT Featured sees the upgrade sheet — the parent_hire gate,
//     fetched from /api/gate on the tap, so the Featured price lives on the
//     sheet and never in the page HTML.
//   * A Featured parent is taken to the existing hire flow (their posted
//     tuitions). A hire is completed against a tutor's APPLICATION to a tuition
//     (jobs.hired_tutor_id), which a card or profile has no context for, so no
//     jobless direct-hire path is invented — the button routes to where hiring
//     happens.

export default function HireButton({
  hired,
  className = '',
}: {
  /** This parent has already hired this tutor on one of their tuitions. */
  hired: boolean
  className?: string
}) {
  const router = useRouter()
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (hired) {
    return (
      <span
        className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-tint-green px-4 text-xs font-bold text-tm-green-deep ${className}`}
      >
        <BadgeCheck aria-hidden size={14} />
        Hired
      </span>
    )
  }

  const onClick = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/gate', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'parent_hire' }),
      })
      const json = (await res.json().catch(() => ({}))) as { gate?: Gate | null }
      // Not Featured → the upgrade sheet carries the Featured price.
      if (json.gate && upgradeSheet?.showGate) {
        upgradeSheet.showGate(json.gate)
        return
      }
      // Featured (no gate returned): the hire is completed in the existing flow,
      // against a tutor's application to a posted tuition.
      toast.success('Open a posted tuition to hire a tutor from its interested tutors.')
      router.push('/parent/dashboard/jobs')
    } catch {
      toast.error('Could not open hire. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60 ${className}`}
    >
      <Handshake aria-hidden size={14} />
      Hire
    </button>
  )
}
