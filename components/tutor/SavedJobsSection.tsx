'use client'

import { useState } from 'react'
import { Heart } from 'lucide-react'

import JobCard, { type JobCardData } from '@/components/JobCard'
import EmptyState from '@/components/EmptyState'

// The tutor's own "Saved tuitions" section on their dashboard — the mirror of
// the parents' ShortlistSection. Cards offer a heart everywhere; this is the
// home for what it saves. Un-hearting a card here drops it from the list.

export default function SavedJobsSection({
  initial,
  viewerCity,
  appliedIds,
}: {
  initial: JobCardData[]
  viewerCity: string | null
  appliedIds: string[]
}) {
  const [jobs, setJobs] = useState(initial)
  const applied = new Set(appliedIds)

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-black uppercase tracking-wider text-gray-500">
        Saved tuitions
      </h2>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Heart aria-hidden size={18} />}
          title="You haven't saved any tuitions yet. Tap the heart on a tuition to keep it here for later."
          action={{ label: 'Browse tuitions', href: '/tutor/dashboard/jobs' }}
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              signedIn
              showApply
              applied={applied.has(job.id)}
              viewerCity={viewerCity}
              saveable
              initiallySaved
              // Un-hearting drops the card from this list; re-hearting elsewhere
              // brings it back on the next load.
              onSavedChange={(saved) => {
                if (!saved) setJobs((list) => list.filter((j) => j.id !== job.id))
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
