import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createReview } from '@/lib/reviews'

// Leave a review.
//
// The eligibility rule lives in lib/reviews.ts and, underneath it, in the RLS
// policy on `reviews` -- so an unearned review is refused even if this route
// is bypassed entirely. That matters more here than in most places: ratings
// feed the search ranking, and a review anybody could write is a ranking
// anybody could buy for the price of a signup.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to leave a review.' }, { status: 401 })

  let body: {
    tutorId?: string
    jobId?: string | null
    demoRequestId?: string | null
    rating?: number
    comment?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.tutorId || !/^[0-9a-f-]{36}$/i.test(body.tutorId)) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }

  const result = await createReview({
    parentId: user.id,
    tutorId: body.tutorId,
    jobId: body.jobId ?? null,
    demoRequestId: body.demoRequestId ?? null,
    rating: Number(body.rating),
    comment: body.comment ?? '',
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true, id: result.id })
}
