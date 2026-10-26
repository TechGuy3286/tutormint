import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createReview } from '@/lib/reviews'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/reviews { applicationId, rating, comment } (owner, 27 Oct 2026) —
// a parent reviews a tutor they hired. Saved as pending; the Owner approves it
// before it is public. The hire rule lives in lib/reviewsCore and, underneath
// it, in the insert policy on `reviews` (migration 204) — so an unearned review
// is refused even if this route is bypassed. Signed out → 401.

const ReviewBody = z.object({
  applicationId: uuid,
  rating: z.coerce.number().int('Choose a rating from 1 to 5.').min(1, 'Choose a rating from 1 to 5.').max(5, 'Choose a rating from 1 to 5.'),
  comment: z.string().max(2000, 'Please keep your review shorter.'),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const parsed = await parseBody(request, ReviewBody)
  if (!parsed.ok) return parsed.response
  const result = await createReview({ parentId: user.id, applicationId: parsed.data.applicationId, rating: Number(parsed.data.rating), comment: parsed.data.comment })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, id: result.id, status: 'pending' })
}
