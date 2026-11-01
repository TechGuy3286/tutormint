import type { Metadata } from 'next'
import { TutorProfileView, tutorProfileMetadata } from './profile'

// /tutor/[slug] — a tutor's public profile, cached for everyone (push 3, owner
// 1 Nov 2026). It renders as a guest sees it; the signed-in parts (contact,
// certificates, report, the action bar) and the view count are done in the
// browser (components/viewer/TutorViewer). Rebuilt when the tutor's profile,
// documents or listing change (revalidatePath via lib/publicRevalidate) and at
// most every 10 minutes. The tutor's own preview of a profile that is not
// public yet is the dynamic twin /qs/tutor/[slug] (proxy.ts sends ?preview=1).
export const revalidate = 600
export async function generateStaticParams() {
  return []
}

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return tutorProfileMetadata((await params).slug)
}

export default async function TutorPublicProfile({ params }: { params: Params }) {
  return <TutorProfileView slug={(await params).slug} ownerId={null} />
}
