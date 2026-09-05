import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteMessageForMe } from '@/lib/messaging'
import { parseBody, z, uuid } from '@/lib/validate'

// "Delete for me." Hides one message for the deleter only — the row is kept and
// stays visible to the other participant (there is no delete-for-everyone). The
// participant check and the append live in deleteMessageForMe.

export const dynamic = 'force-dynamic'

const Body = z.object({ messageId: uuid })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await deleteMessageForMe(user.id, parsed.data.messageId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
