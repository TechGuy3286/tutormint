import { NextResponse } from 'next/server'

import { rankedTutors, tutorFiltersFrom } from '@/lib/browseTutors'
import { createClient } from '@/lib/supabase/server'

// Load-more for /browse/tutors.
//
// PUBLIC, like the page it extends — browsing never asks for an account, so
// this answers an anonymous request the same way. rank_tutors() is SECURITY
// DEFINER and its RETURNS TABLE is the allowlist: phone, WhatsApp, email and
// the CNIC columns are not in it and cannot leave through here.
//
// The only thing the signed-in caller gets extra is which of these tutors they
// have already shortlisted, read through their OWN client so RLS decides it —
// the alternative, trusting a user id in the query string, would let anyone
// read anyone's shortlist.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12

export async function GET(request: Request) {
  const url = new URL(request.url)
  const get = (k: string) => (url.searchParams.get(k) ?? '').trim()

  const { tutors, nextCursor, error } = await rankedTutors({
    filters: tutorFiltersFrom(get),
    limit: PAGE_SIZE,
    cursor: get('cursor') || null,
  })

  if (error) {
    return NextResponse.json({ error: 'Could not load more tutors.' }, { status: 502 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let saved: string[] = []
  if (user && tutors.length > 0) {
    const { data } = await supabase
      .from('shortlists')
      .select('tutor_id')
      .in(
        'tutor_id',
        tutors.map((t) => t.id),
      )
    saved = (data ?? []).map((s) => s.tutor_id as string)
  }

  return NextResponse.json({ items: tutors, cursor: nextCursor, saved })
}
