import { redirect, permanentRedirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Old inbound links pointed at /browse/tutors/<uuid>. There is one canonical
// public profile now -- /tutor/[slug] -- and two URLs for the same tutor split
// the search ranking between them, so this segment resolves the id and sends
// the reader (and the crawler) there permanently.
//
// The page it replaced rendered a hardcoded MOCK_TUTORS map: four invented
// tutors with invented ratings and a shared phone number.

export const dynamic = 'force-dynamic'

export default async function LegacyTutorRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('tutor_directory')
      .select('slug')
      .eq('id', id)
      .maybeSingle()

    if (data?.slug) permanentRedirect(`/tutor/${data.slug}`)
  }

  // Unknown or unlisted: back to the directory rather than a dead end.
  redirect('/browse/tutors')
}
