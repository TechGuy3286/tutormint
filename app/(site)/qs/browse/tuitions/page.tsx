import type { Metadata } from 'next'
import { BrowseTuitionsView, tuitionsMetadata } from '../../../browse/tuitions/BrowseTuitionsView'

// The live twin of /browse/tuitions (owner, 2 Nov 2026 — phone speed). proxy.ts
// rewrites here every request that carries a filter or a sign-in cookie; the
// visitor's address bar still reads /browse/tuitions…, and the canonical is the
// clean address. Renders exactly what the page rendered before.
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return tuitionsMetadata(await searchParams)
}

export default async function BrowseTuitionsLivePage({ searchParams }: { searchParams: SearchParams }) {
  return <BrowseTuitionsView sp={await searchParams} />
}
