import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadDocumentStatuses } from '@/lib/tutorDocuments'

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
  return NextResponse.json(statuses)
}
