'use client'

import { useState } from 'react'
import { Heart } from 'lucide-react'

import TutorCard, { type TutorCardData, type CardViewer } from '@/components/TutorCard'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { submitSignal } from '@/lib/submit'

// The parent's "Shortlisted tutors" CARD on their dashboard (PR26 §1).
//
// ONE card, with its heading inside — nothing loose on the dashboard — mirroring
// the tutor side's SavedJobsSection. Each shortlisted tutor is the same TutorCard
// the parent sees on browse, so its four actions (View profile, Message, Demo
// lesson, Hire) sit in the card's own button grid. Removal is a small X at the
// top-right of each card, behind a confirm; there is no separate "Remove"
// button. The card hides itself when the shortlist is empty.

export default function ShortlistSection({
  initial,
  viewer,
  hiredIds = [],
}: {
  initial: TutorCardData[]
  viewer: CardViewer
  /** Tutors this parent has already hired — their card's Hire reads "Hired" (§1). */
  hiredIds?: string[]
}) {
  const [tutors, setTutors] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const remove = async (t: TutorCardData) => {
    const ok = await confirm({
      title: `Remove ${t.full_name} from your shortlist?`,
      body: 'You can shortlist them again any time from their profile or from browse.',
      confirmLabel: 'Remove',
    })
    if (!ok) return
    setBusy(t.id)
    try {
      const res = await fetch('/api/shortlist', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: t.id, action: 'remove' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not update your shortlist.')
      setTutors((list) => list.filter((x) => x.id !== t.id))
      toast.success('Removed from your shortlist.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update your shortlist.')
    } finally {
      setBusy(null)
    }
  }

  if (tutors.length === 0) return null

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
        <Heart aria-hidden size={16} className="text-gray-500" />
        Shortlisted tutors
      </h2>
      <div className="space-y-4">
        {tutors.map((t) => (
          <TutorCard
            key={t.id}
            tutor={t}
            viewer={viewer}
            initiallySaved
            hideShortlist
            showMessage={viewer.role !== 'tutor'}
            showHire
            hired={hiredIds.includes(t.id)}
            onRemove={() => void remove(t)}
            removeBusy={busy === t.id}
          />
        ))}
      </div>
    </section>
  )
}
