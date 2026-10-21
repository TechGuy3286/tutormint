import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { tutorsRedirect } from '@/lib/peopleDirectoryCore'

// Verification → Tutors moved to People → Tutors (owner, 21 Oct 2026). The old
// address — and its ?filter= / ?q= — opens the matching tab and chip. The intro
// video review that lived here is at /admin/tutors/videos.

export const dynamic = 'force-dynamic'

export default async function TutorsMoved({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.tutors)
  redirect(tutorsRedirect(await searchParams))
}
