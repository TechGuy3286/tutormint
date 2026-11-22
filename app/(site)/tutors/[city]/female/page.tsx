import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityTutorsView from '@/components/landing/CityTutorsView'
import { cityTutorsMetadata, resolveTutorCity } from '../shared'

// /tutors/[city]/female — "Female tutors in <City>" (owner, 20 Nov 2026 —
// PR-11). Indexable from 3 indexable female tutors; noindex, follow below.
// A static segment, so it wins over /tutors/[city]/[subject].
export const revalidate = 86400
export async function generateStaticParams() {
  return []
}

type Params = Promise<{ city: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city } = await params
  return cityTutorsMetadata(city, true)
}

export default async function FemaleCityTutorsPage({ params }: { params: Params }) {
  const { city } = await params
  const c = await resolveTutorCity(city)
  if (!c) notFound()
  return <CityTutorsView city={c} female page={1} />
}
