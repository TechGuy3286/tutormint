'use client'

import JobCard, { type JobCardData } from '@/components/JobCard'

// The gallery is a server component, so the Apply variant needs a client
// wrapper to hold the callback. Only exists to demonstrate the button; the
// real apply flow (quota, applications table, blocks) is T5.

export default function ApplyDemo({ job }: { job: JobCardData }) {
  return <JobCard job={job} href="#" signedIn={false} onApply={() => {}} />
}
