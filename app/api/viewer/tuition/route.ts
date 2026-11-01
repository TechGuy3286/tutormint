import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { createClient } from '@/lib/supabase/server'
import { applyBlocksFor } from '@/lib/applyBlockServer'
import { peekTuitionContact } from '@/lib/contactReveal'
import { loadReceiptState } from '@/lib/payments/receipt'
import { pauseCountdownLabel, pauseDueAtMs } from '@/lib/tuitionStatus'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshAllowed } from '@/lib/duplicatesCore'
import { posterToolsVisible } from '@/lib/posterToolsCore'
import type { TuitionViewer } from '@/lib/tuitionViewerCore'
import type { ApplyBlock } from '@/lib/applyBlock'

// The signed-in visitor's side of one tuition page (push 3, owner 1 Nov 2026).
// The page itself is cached for everyone; it asks here, once, when the visitor
// has a sign-in cookie: applied or not, why Apply is inactive, an earlier
// number reveal, the poster's Resume / Refresh and pause countdown. The same
// reads the page made on the server before. Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, ...NO_STORE })
  const session = await getSessionUser().catch(() => null)
  if (!session) return NextResponse.json({ signedIn: false } satisfies TuitionViewer, NO_STORE)
  const userId = session.user.id
  const supabase = await createClient()
  const [ent, { data: job }] = await Promise.all([
    getEntitlements(userId),
    supabase.from('jobs').select('id, status, parent_id, created_at, resumed_at, refreshed_at').eq('id', id).maybeSingle(),
  ])
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404, ...NO_STORE })
  const isTutor = ent.audience === 'tutor'
  const isAdmin = ent.role === 'admin'
  const isPoster = job.parent_id === userId
  let applied = false
  let tutorGender: string | null = null
  let applyBlock: ApplyBlock | null = null
  let feeReceiptPending = false
  let revealedContact = null as Awaited<ReturnType<typeof peekTuitionContact>>
  if (isTutor) {
    const [{ data: mine }, { data: me }, peeked] = await Promise.all([
      supabase.from('applications').select('id').eq('tutor_id', userId).eq('job_id', id).maybeSingle(),
      supabase.from('tutor_profiles').select('gender').eq('id', userId).maybeSingle(),
      peekTuitionContact(userId, id),
    ])
    applied = !!mine
    tutorGender = (me?.gender as string | null) ?? null
    revealedContact = peeked
    applyBlock = (await applyBlocksFor(supabase, userId, ent, [{ id, status: job.status as string }]))[id] ?? null
    if (!ent.verified) feeReceiptPending = (await loadReceiptState(userId, 'verified')).state === 'under_review'
  }
  // Team-posted: the poster account is the team account. Only asked for staff.
  let teamPost = false
  if (isAdmin && !isPoster && job.parent_id) {
    const admin = createAdminClient()
    const { data: p } = admin
      ? await admin.from('profiles').select('is_team_account').eq('id', job.parent_id as string).maybeSingle()
      : { data: null }
    teamPost = !!p?.is_team_account
  }
  const tools = posterToolsVisible({ isPoster, isAdmin }, teamPost)
  const base = (job.resumed_at as string | null) ?? (job.created_at as string)
  const pauseLabel = tools && job.status === 'open' ? pauseCountdownLabel(base) : null
  const pauseDaysLeft = tools && job.status === 'open' ? Math.max(0, Math.floor((pauseDueAtMs(base) - Date.now()) / 86_400_000)) : null
  const refreshNextAt = tools ? refreshAllowed(job.refreshed_at as string | null).nextAt : null
  return NextResponse.json(
    { signedIn: true, isTutor, isAdmin, isPoster, applied, tutorGender, applyBlock, feeReceiptPending, revealedContact, pauseLabel, teamPost, pauseDaysLeft, refreshNextAt } satisfies TuitionViewer,
    NO_STORE,
  )
}
