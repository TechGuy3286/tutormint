'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// The two-audience packages page (owner PR13 §1.1). One page, a Tutors tab and a
// Parents tab; the initial tab is decided on the server (a signed-in tutor opens
// on Tutors, a parent on Parents, a logged-out visitor on Tutors, and ?for=
// overrides). Both panels are server-rendered and passed in as nodes, so their
// data is in the HTML; this component only toggles which one is visible and
// keeps the ?for= in the URL in step so a shared/back link lands on the same tab.

type Tab = 'tutors' | 'parents'

export default function PackagesTabs({
  initialTab,
  tutorPanel,
  parentPanel,
}: {
  initialTab: Tab
  tutorPanel: React.ReactNode
  parentPanel: React.ReactNode
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(initialTab)

  const select = (next: Tab) => {
    setTab(next)
    // Keep the URL honest without a reload, so a copied link reopens this tab.
    router.replace(`/membership-plans?for=${next}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Membership plans for" className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
        {(['tutors', 'parents'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => select(t)}
            className={`min-h-[40px] rounded-lg px-5 text-xs font-black transition-colors ${
              tab === t ? 'bg-tm-navy text-white' : 'text-gray-500 hover:text-tm-navy'
            }`}
          >
            {t === 'tutors' ? 'For tutors' : 'For parents'}
          </button>
        ))}
      </div>

      <div role="tabpanel" hidden={tab !== 'tutors'}>
        {tutorPanel}
      </div>
      <div role="tabpanel" hidden={tab !== 'parents'}>
        {parentPanel}
      </div>
    </div>
  )
}
