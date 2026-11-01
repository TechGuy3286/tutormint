import { permanentRedirect } from 'next/navigation'

import { memberEditHref } from '@/lib/memberEditCore'

// The tutor record page was merged into the member page's Edit tab (owner,
// 31 Oct 2026). Old links and bookmarks land there. The admin layout's own
// sign-in check runs first, so a signed-out visitor goes to /login.

export default async function TutorRecordRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  permanentRedirect(memberEditHref(id))
}
