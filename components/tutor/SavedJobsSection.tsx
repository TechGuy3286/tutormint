'use client'

import { useState } from 'react'
import { Heart } from 'lucide-react'

import JobCard, { type JobCardData } from '@/components/JobCard'

// The tutor's own "Saved tuitions" CARD on their dashboard — the mirror of the
// parents' ShortlistSection. Cards offer a heart everywhere; this is the home for
// what it saves. Un-hearting a card here drops it from the list.
//
// PR17 §1.4/§1.5 — a self-contained card with its title inside, and it HIDES
// itself (renders nothing) when there is nothing saved, since the dashboard is
// cards-only and empty cards are hidden.

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

  if (jobs.length === 0) return null

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
        <Heart aria-hidden size={16} className="text-gray-500" />
        Saved tuitions
      </h2>
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
    </section>
  )
}
