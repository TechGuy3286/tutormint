import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityTutorsView from '@/components/landing/CityTutorsView'
import { cityTutorsMetadata, resolveTutorCity } from './shared'

// /tutors/[city] — "Tutors in <City>" (owner, 20 Nov 2026 — PR-11). Cached for
// everyone and rebuilt at most every 10 minutes (and with the landing pages);
// ?page= goes to the twin under /qs (proxy.ts), so this page never reads the
// query. Indexable from 3 indexable tutors; noindex, follow below that.
export const revalidate = 600
export async function generateStaticParams() {
  return []
}

type Params = Promise<{ city: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city } = await params
  return cityTutorsMetadata(city, false)
}

export default async function CityTutorsPage({ params }: { params: Params }) {
  const { city } = await params
  const c = await resolveTutorCity(city)
  if (!c) notFound()
  return <CityTutorsView city={c} female={false} page={1} />
}
