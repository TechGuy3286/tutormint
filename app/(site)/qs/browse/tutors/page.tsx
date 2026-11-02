import type { Metadata } from 'next'
import { BrowseTutorsView, tutorsMetadata } from '../../../browse/tutors/BrowseTutorsView'

// The live twin of /browse/tutors (owner, 2 Nov 2026 — phone speed). proxy.ts
// rewrites here every request that carries a filter or a sign-in cookie; the
// visitor's address bar still reads /browse/tutors…, and the canonical is the
// clean address. Renders exactly what the page rendered before.
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return tutorsMetadata(await searchParams)
}

export default async function BrowseTutorsLivePage({ searchParams }: { searchParams: SearchParams }) {
  return <BrowseTutorsView sp={await searchParams} />
}
