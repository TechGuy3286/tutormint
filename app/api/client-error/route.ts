import { NextResponse } from 'next/server'

import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'

// Where a swallowed client-side error goes in production.
//
// lib/silentFailure.ts sends here when a handler catches something it has
// decided not to show the member — a gate that would not load, a mark-read
// that failed, a suggestion request that died. In development that is a
// console.error and this route is never called; in production the browser
// console is nobody's, so the line has to reach a log somebody reads.
//
// IT ONLY LOGS. No table, no notification, no alert. A row in the database
// would need a retention policy, an RLS story and a screen to read it on, and
// the problem being solved is "nothing anywhere said the button was broken",
// which one line in the Vercel log solves completely.
//
// UNAUTHENTICATED ON PURPOSE. A signed-out visitor pressing a broken button is
// exactly the case worth hearing about, and requiring a session would drop it.
// The user id is attached when there is one, because "which member" is usually
// the first question — and it is read from the SESSION, never from the body.
//
// Rate-limited by IP, and the payload is capped by the schema: this endpoint
// takes text from anybody on the internet and writes it into our logs, so it
// is treated as hostile input that happens to usually be ours.

export const dynamic = 'force-dynamic'

const Body = z.object({
  scope: z.string().min(1).max(80),
  detail: z.string().max(500),
  path: z.string().max(300).nullable().optional(),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
})

function callerIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0] : null)?.trim() || 'unknown'
}

export async function POST(request: Request) {
  const limit = await rateLimit('client_error', callerIp(request))
  // Silently accepted rather than 429'd: the caller is a fire-and-forget
  // beacon that cannot act on a refusal, and answering with an error would
  // only add a second failure on top of the line we already declined to write.
  if (!limit.allowed) return NextResponse.json({ ok: true })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const { scope, detail, path, context } = parsed.data

  let userId: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    // Identifying the member is a nicety. Losing the report over it is not.
  }

  console.error(
    '[silent-failure]',
    JSON.stringify({ scope, detail, path: path ?? null, userId, context: context ?? null }),
  )

  return NextResponse.json({ ok: true })
}
