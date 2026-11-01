import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { TutorProfileView } from '../../../tutor/[slug]/profile'

// The owner's preview of their own profile before it is public (owner PR12
// §3.2), moved here by push 3 (owner, 1 Nov 2026) so /tutor/[slug] itself can
// be cached. proxy.ts rewrites /tutor/<slug>?preview=1 here; the address bar
// keeps /tutor/<slug>?preview=1. Only the signed-in tutor whose slug it is sees
// anything; everyone else gets the normal page. Never indexed.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function OwnProfilePreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSessionUser().catch(() => null)
  if (!slug) notFound()
  return <TutorProfileView slug={slug} ownerId={session?.user.id ?? null} />
}
