import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { loadQuickReplies, messagePage, threadHeader } from '@/lib/messaging'
import { mayAttachPhoto, DEFAULT_QUICK_REPLIES } from '@/lib/messagingRules'

// One conversation's data for the desktop messages dock (PR 4 §2). It reuses the
// EXACT server functions InboxShell uses — threadHeader, messagePage,
// getEntitlements, loadQuickReplies — so masking, reply-only and every
// permission are computed once, in one place; the dock adds no messaging logic.
//
// threadHeader returns null for a thread that is not this member's, does not
// exist, or is between a blocked pair — all become 404 here, exactly as the
// inbox page does, so this is not a way to enumerate conversations.

export const runtime = 'nodejs'

const MESSAGE_PAGE = 30

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: me } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle()
  const role = me?.role === 'tutor' ? 'tutor' : 'parent'

  const header = await threadHeader(user.id, id)
  if (!header) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const [ent, history, quickReplies] = await Promise.all([
    getEntitlements(user.id),
    messagePage({ userId: user.id, threadId: header.id, limit: MESSAGE_PAGE, canShareContact: header.canShareContact }),
    role === 'tutor' ? loadQuickReplies(user.id) : Promise.resolve([] as string[]),
  ])

  const chips = role === 'tutor' ? (quickReplies.length > 0 ? quickReplies : DEFAULT_QUICK_REPLIES) : []

  return NextResponse.json({
    header: {
      id: header.id,
      otherId: header.otherId,
      otherName: header.otherName,
      otherAvatar: header.otherAvatar,
      jobTitle: header.jobTitle ?? null,
    },
    items: history?.items ?? [],
    cursor: history?.cursor ?? null,
    canShareContact: header.canShareContact,
    suspended: ent.suspended,
    canAttach: mayAttachPhoto(ent),
    selfName: ((me?.full_name as string | null) || 'You').split(' ')[0],
    contactReason: role === 'tutor' ? 'tutor_contact' : 'parent_contact',
    quickReplies: chips,
  })
}
