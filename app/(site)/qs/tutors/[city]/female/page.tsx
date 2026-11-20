import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityTutorsView from '@/components/landing/CityTutorsView'
import { cityTutorsMetadata, pageFrom, resolveTutorCity } from '../../../../tutors/[city]/shared'

// The ?page= twin of /tutors/[city]/female (PR-11): proxy.ts rewrites here so the
// clean address stays cached. Same page, server-rendered for that page number.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ city: string }>; searchParams: Promise<{ page?: string | string[] }> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [p, sp] = await Promise.all([params, searchParams])
  return cityTutorsMetadata(p.city, true, pageFrom(sp.page))
}

export default async function Page({ params, searchParams }: Props) {
  const [p, sp] = await Promise.all([params, searchParams])
  const c = await resolveTutorCity(p.city)
  if (!c) notFound()
  return <CityTutorsView city={c} female={true} page={pageFrom(sp.page)} />
}
