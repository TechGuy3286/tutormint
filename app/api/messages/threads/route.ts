import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { threadPage } from '@/lib/messaging'

// One page of the conversation list, for the inbox's infinite scroll.
//
// The first page is server-rendered by the inbox page itself, the same way
// /browse/tutors does it. This route only appends, so a member never sees a
// "Loading conversations…" where their conversations should be.
//
// THE VIEWER IS THE SESSION, never a query parameter. There is no `userId`
// input to this route and there must never be one: `threadPage` scopes every
// query to the id passed in, so accepting one from the URL would turn a scoped
// read into a way to page through somebody else's inbox.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to read your messages.' }, { status: 401 })

  const url = new URL(request.url)
  const page = await threadPage({
    userId: user.id,
    limit: PAGE_SIZE,
    cursor: url.searchParams.get('cursor'),
    q: url.searchParams.get('q'),
  })

  return NextResponse.json(page)
}
