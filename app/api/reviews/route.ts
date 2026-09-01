import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createReview } from '@/lib/reviews'
import { parseBody, z, uuid } from '@/lib/validate'

// Leave a review.
//
// The eligibility rule lives in lib/reviews.ts and, underneath it, in the RLS
// policy on `reviews` -- so an unearned review is refused even if this route
// is bypassed entirely. That matters more here than in most places: ratings
// feed the search ranking, and a review anybody could write is a ranking
// anybody could buy for the price of a signup.

const ReviewBody = z.object({
  tutorId: uuid,
  jobId: uuid.nullish(),
  demoRequestId: uuid.nullish(),
  rating: z.coerce
    .number()
    .int('Give a whole number of stars.')
    .min(1, 'Give a rating from 1 to 5.')
    .max(5, 'Give a rating from 1 to 5.'),
  comment: z.string().max(2000, 'Keep your review under 2000 characters.').optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to leave a review.' }, { status: 401 })

  const parsed = await parseBody(request, ReviewBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
