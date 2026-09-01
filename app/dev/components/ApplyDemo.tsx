'use client'

import JobCard, { type JobCardData } from '@/components/JobCard'

// The gallery is a server component; this wrapper exists only so the Apply
// variant of the card can be seen. As a guest, pressing Apply opens the
// sign-in modal, which is the state worth reviewing.

export default function ApplyDemo({ job }: { job: JobCardData }) {
  return <JobCard job={job} href="#" signedIn={false} showApply />
}
