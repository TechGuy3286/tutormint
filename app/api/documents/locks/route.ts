import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLockViews } from '@/lib/docLocks'

// The signed-in member's own document locks (owner, 9 Oct 2026): for the CNIC
// front, CNIC back and selfie, whether the upload control is open, locked
// (approved), unlocked by staff for one re-upload, or waiting on a new upload.
// Every member upload screen reads this; the upload route enforces it.

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })
  return NextResponse.json(await getLockViews(user.id))
}
