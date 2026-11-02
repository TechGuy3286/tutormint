import type { Metadata } from 'next'
import { BrowseTutorsView, tutorsMetadata } from './BrowseTutorsView'

// The bare /browse/tutors for a signed-out visitor, cached at the edge and
// rebuilt every 5 minutes (owner, 2 Nov 2026 — phone speed). It renders exactly
// as a guest sees the live page. A request with any filter, or from a visitor
// with a sign-in cookie, is rewritten by proxy.ts to the live twin
// app/(site)/qs/browse/tutors (lib/queryTwinCore), so members keep their own
// view and filtered searches stay live.
export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  return tutorsMetadata({})
}

export default async function BrowseTutorsPage() {
  return <BrowseTutorsView sp={{}} guest />
}
