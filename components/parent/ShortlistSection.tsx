'use client'

import { useState } from 'react'
import { Heart, X } from 'lucide-react'

import TutorCard, { type TutorCardData, type CardViewer } from '@/components/TutorCard'
import EmptyState from '@/components/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { submitSignal } from '@/lib/submit'

// The parent's own "Shortlisted tutors" section on their dashboard.
//
// Cards offer a Shortlist action everywhere, but until now a parent had no
// screen that showed the result — the shortlist was write-only. This is the
// home for it: the same TutorCard (same CardActions row) they see on browse,
// with the in-card Shortlist toggle hidden in favour of ONE explicit "Remove
// from shortlist" that confirms and drops the card from the list.

export default function ShortlistSection({
  initial,
  viewer,
}: {
  initial: TutorCardData[]
  viewer: CardViewer
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

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-black uppercase tracking-wider text-gray-500">
        Shortlisted tutors
      </h2>

      {tutors.length === 0 ? (
        <EmptyState
          icon={<Heart aria-hidden size={18} />}
          title="You haven't shortlisted any tutors yet. Tap the heart on a tutor to save them here for later."
          action={{ label: 'Browse tutors', href: '/browse/tutors' }}
        />
      ) : (
        <div className="space-y-4">
          {tutors.map((t) => (
            <div key={t.id} className="space-y-2">
              <TutorCard
                tutor={t}
                viewer={viewer}
                initiallySaved
                showMessage={viewer.role !== 'tutor'}
                hideShortlist
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void remove(t)}
                  disabled={busy === t.id}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-red px-4 text-xs font-bold text-tm-red transition-colors hover:bg-tm-tint-red disabled:opacity-60"
                >
                  <X aria-hidden size={13} />
                  {busy === t.id ? 'Removing…' : 'Remove from shortlist'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
