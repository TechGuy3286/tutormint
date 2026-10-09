import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadDocumentStatuses, type DocState } from '@/lib/tutorDocuments'
import { getLockViews } from '@/lib/docLocks'

// The signed-in tutor's own CNIC / profile-picture / selfie approval status
// (PR60), for the Settings status display. No contact, no other member's data —
// only the caller's own statuses.

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const statuses = await loadDocumentStatuses(user.id)
  // The member's own record is still APPROVED while a new upload waits (the
  // badge and listing do not move); the lock views say "new upload sent".
  const own = (s: DocState): DocState => (s.rereview ? { status: 'approved', reason: null, hasUpload: true } : s)
  return NextResponse.json({
    cnic: own(statuses.cnic),
    profilePic: own(statuses.profilePic),
    selfie: own(statuses.selfie),
    locks: await getLockViews(user.id),
  })
}
