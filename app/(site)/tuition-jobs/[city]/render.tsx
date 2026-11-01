import { notFound } from 'next/navigation'
import CityJobsView from '@/components/tuitionJobs/CityJobsView'
import { cityPageBySlug } from '@/lib/cityJobs'

/** The city hub, shared by the cached page and its /qs query twin (push 3). */
export async function renderCityPage(city: string, pageNo: number) {
  const page = await cityPageBySlug(city)
  if (!page) notFound()
  return <CityJobsView page={page} variant={null} pageNo={pageNo} />
}
