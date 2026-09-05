import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadQuickReplies, saveQuickReplies } from '@/lib/messaging'
import { sanitizeQuickReplies } from '@/lib/messagingRules'

// A tutor's quick replies — the chips above their composer, editable in
// Settings. Owner-only by RLS (tutor_id = auth.uid()); the role check here keeps
// a parent from calling it at all.

export const dynamic = 'force-dynamic'

async function tutorOrNull() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { user: null, isTutor: false }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return { user, isTutor: profile?.role === 'tutor' }
}

export async function GET() {
  const { user, isTutor } = await tutorOrNull()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  if (!isTutor) return NextResponse.json({ error: 'Tutors only.' }, { status: 403 })
  return NextResponse.json({ replies: await loadQuickReplies(user.id) })
}

export async function POST(request: Request) {
  const { user, isTutor } = await tutorOrNull()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  if (!isTutor) return NextResponse.json({ error: 'Tutors only.' }, { status: 403 })

  let raw: unknown = []
  try {
    const body = (await request.json()) as { replies?: unknown }
    raw = body.replies
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 })
  }

  const replies = sanitizeQuickReplies(raw)
  await saveQuickReplies(user.id, replies)
  return NextResponse.json({ success: true, replies })
}
