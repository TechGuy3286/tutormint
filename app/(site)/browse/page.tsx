// Redirect only; nothing to cache (owner, 2 Nov 2026).
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

export default function BrowsePage() {
  redirect('/browse/tutors')
}
