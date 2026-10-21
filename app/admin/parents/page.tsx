import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parentsRedirect } from '@/lib/peopleDirectoryCore'

// Verification → Parents moved to People → Parents (owner, 21 Oct 2026). The old
// address — and its ?filter= — opens the matching tab and chip. Parent
// documents are reviewed on the member page, as before.

export const dynamic = 'force-dynamic'

export default async function ParentsMoved({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.parents)
  redirect(parentsRedirect(await searchParams))
}
