import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findOrCreateThread } from '@/lib/messaging'
import { parseBody, z, uuid } from '@/lib/validate'

// Open (or reopen) a conversation with someone.
//
// Who may start one is decided in lib/messaging.ts: any verified parent, and a
// tutor only on premium or featured. Blocked pairs are refused in both
// directions with the same neutral wording, so nobody learns they were blocked.

const ThreadBody = z.object({
  otherId: uuid,
  jobId: uuid.nullish(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to send a message.' }, { status: 401 })

  const parsed = await parseBody(request, ThreadBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (!body.otherId || !/^[0-9a-f-]{36}$/i.test(body.otherId)) {
    return NextResponse.json({ error: 'Missing recipient.' }, { status: 400 })
  }

  const result = await findOrCreateThread({
    actorId: user.id,
    otherId: body.otherId,
    jobId: body.jobId ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade }, { status: result.status })
  }

  return NextResponse.json({ success: true, threadId: result.threadId, created: result.created })
}
