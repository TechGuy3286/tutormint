'use client'

import { useState } from 'react'
import Link from 'next/link'

import AuthGateModal from '@/components/AuthGateModal'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'

// Apply, from a tuition's own page.
//
// The same call and the same gate as the card's button -- /api/applications
// re-checks listed, blocked, open, already-applied and quota regardless of
// what rendered here, and a refusal caused by a plan opens the upgrade sheet
// rather than printing a price on a page nobody asked to see a price on.
//
// A guest sees the button and gets the sign-in modal, with the job kept as a
// draft so they land back on it. That is the "feels free" rule: nobody is
// asked to sign in until they reach for a transactional action.

export default function ApplyPanel({
  jobId,
  title,
  signedIn,
  applied,
}: {
  jobId: string
  title: string
  signedIn: boolean
  applied: boolean
}) {
  const upgradeSheet = useUpgradeSheet()
  const [gateOpen, setGateOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>(applied ? 'done' : 'idle')
  const [notice, setNotice] = useState<string | null>(null)

  const apply = async () => {
    if (!signedIn) return setGateOpen(true)
    setState('sending')
    setNotice(null)
    const r = await postGated('/api/applications', { jobId }, upgradeSheet?.showGate)
    if (r.ok) {
      setState('done')
      setNotice('Application sent. The parent can see your profile and message you.')
      return
    }
    setNotice(r.gated ? null : r.error)
    setState('idle')
  }

  return (
    <>
      <div className="space-y-2">
        <button
          type="button"
          onClick={apply}
          disabled={state !== 'idle'}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-5 text-sm font-bold text-white transition-colors hover:bg-tm-red-hover disabled:bg-gray-300 sm:w-auto sm:px-8"
        >
          {state === 'done' ? 'Applied' : state === 'sending' ? 'Sending…' : 'Apply for this tuition'}
        </button>

        {notice && <p className="text-xs font-semibold leading-relaxed text-slate-700">{notice}</p>}

        {state === 'done' && (
          <p className="text-xs text-gray-500">
            Track it on{' '}
            <Link
              href="/tutor/dashboard/applications"
              className="font-bold text-tm-red hover:underline"
            >
              your applications
            </Link>
            .
          </p>
        )}
      </div>

      <AuthGateModal
        open={gateOpen}
        intent="apply"
        draft={{ jobId, title }}
        onClose={() => setGateOpen(false)}
      />
    </>
  )
}
