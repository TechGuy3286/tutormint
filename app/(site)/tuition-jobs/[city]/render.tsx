import { notFound } from 'next/navigation'
import CityJobsView from '@/components/tuitionJobs/CityJobsView'
import { cityPageOrEmpty } from '@/lib/cityJobs'

/** The city hub, shared by the cached page and its /qs query twin (push 3). */
export async function renderCityPage(city: string, pageNo: number) {
  // A known city with no open tuition renders "No tuitions here yet" (16 Nov 2026).
  const page = await cityPageOrEmpty(city)
  if (!page) notFound()
  return <CityJobsView page={page} variant={null} pageNo={pageNo} />
}
