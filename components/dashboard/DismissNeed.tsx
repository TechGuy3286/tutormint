'use client'

import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { reportSilentFailure } from '@/lib/silentFailure'
import { submitJson } from '@/lib/submit'

// The dismiss control on the lapsed-plan row.
//
// ONE ROW IN THIS BAND IS DISMISSABLE and it is not an oversight that the
// others are not: an unverified CNIC does not stop blocking a parent because
// somebody pressed a cross, and a band where everything can be waved away is a
// band that gets waved away. A plan that has ended is different -- the member
// may simply have decided not to renew, and repeating it on every visit for
// the rest of the year is nagging rather than informing.
//
// It disappears optimistically. Waiting for the round trip on a control whose
// whole purpose is "stop showing me this" reads as a button that did nothing;
// a failure puts it back and is reported to us rather than to them, because
// the worst case is a row they have to dismiss again.

export default function DismissNeed({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const [gone, setGone] = useState(false)

  if (gone) return null

  return (
    <button
      type="button"
      aria-label="Dismiss this notice"
      onClick={async () => {
        setGone(true)
        const { ok, error } = await submitJson('/api/plan/dismiss-lapse', { subscriptionId })
        if (!ok) {
          setGone(false)
          reportSilentFailure('DismissNeed', error ?? 'dismiss failed', { subscriptionId })
          return
        }
        router.refresh()
      }}
      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-tm-bg hover:text-tm-navy"
    >
      <X aria-hidden size={15} />
    </button>
  )
}
