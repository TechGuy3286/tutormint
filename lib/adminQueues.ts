import 'server-only'

import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { publicAdUrl } from '@/lib/ads'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeUtm } from '@/lib/utm'
import type { AdminRole } from '@/lib/adminAuth'
import { SCREEN_ACCESS } from '@/lib/adminAuth'

// The admin lists that still ended at a hard cap, on the platform's
// infinite-scroll pattern.
//
// Seven of them: the tutor and parent verification queues, the payments queue
// and the subscription ledger beside it, the reports queue and the block list
// beside that, the advertisements list, and the member timeline. Two lists on
// one screen page independently -- reading further down the ledger has nothing
// to do with the queue above it.
//
// WHY THE FETCH MOVED OUT OF THE PAGES. Each of these lists is now read from
// two places -- the server component that renders the first window, and the
// route that appends the next one -- and the two must agree about filters,
// ordering and shape or a reader gets duplicate rows at the seam. One function
// per queue is the only way that stays true when a filter is added later.
//
// THE KEY IS TOTAL. Every cursor is (order column, id), never the order column
// alone: `created_at` is not unique, and two rows in the same millisecond are
// ordinary on a queue an admin is working or an import that just ran. Without
// the id tiebreaker the page boundary can straddle a pair and lose one of them.
//
// OFFSET IS GONE HERE, unlike /browse. These screens have no crawler and no
// ?page=N URLs to honour; a moderator always holds the last row on screen, and
// OFFSET is wrong for that -- between two requests a payment is approved or a
// report resolved, every row above the window shifts, and the reader sees the
// same row twice or never sees one at all.

export type QueueKind =
  | 'tutors'
  | 'parents'
  | 'payments'
  | 'subscriptions'
  | 'reports'
  | 'blocks'
  | 'ads'
  | 'timeline'

/** Which roles may read each queue. The route re-checks; nothing trusts a screen. */
export const QUEUE_SCREEN: Record<QueueKind, AdminRole[]> = {
  tutors: SCREEN_ACCESS.tutors,
  parents: SCREEN_ACCESS.parents,
  payments: SCREEN_ACCESS.payments,
  // The ledger sits on the payments screen and is read by the same roles.
  subscriptions: SCREEN_ACCESS.payments,
  reports: SCREEN_ACCESS.reports,
  // The block list sits on the reports screen, likewise.
  blocks: SCREEN_ACCESS.reports,
  ads: SCREEN_ACCESS.ads,
  // The member timeline, on /admin/users/[id].
  timeline: SCREEN_ACCESS.users,
}

/**
 * The timeline's filter buckets.
 *
 * They live here rather than on the page because the filter now runs IN THE
 * QUERY. Filtering 300 fetched rows in JavaScript quietly meant that a member
 * with 300 logins had no visible payments at all -- the money group was
 * filtering a window that never reached one.
 */
export const TIMELINE_GROUPS: Record<string, string[]> = {
  account: [
    'registered', 'login', 'otp_verified', 'profile_updated', 'completion_changed',
    'subjects_changed', 'document_uploaded', 'video_submitted', 'verification_submitted',
    'verification_decision_received', 'video_visibility_changed',
  ],
  activity: [
    'job_posted', 'job_edited', 'job_closed', 'application_submitted', 'application_withdrawn',
    'demo_requested', 'demo_accepted', 'demo_declined', 'demo_completed', 'message_sent',
    'shortlist_added', 'shortlist_removed', 'profile_viewed', 'search_performed',
  ],
  money: [
    'payment_submitted', 'payment_rejected', 'plan_purchased', 'plan_expiring', 'plan_granted',
    'plan_revoked', 'plan_expired',
  ],
  moderation: [
    'blocked', 'blocked_by', 'unblocked', 'reported', 'reported_by', 'report_resolved',
    'warned', 'suspended', 'unsuspended', 'staff_created', 'staff_role_changed',
    'staff_suspended', 'staff_reactivated',
  ],
}

/**
 * The server-rendered first window.
 *
 * Smaller than the old 100-row cap on purpose: the cap was there because the
 * page had no way to ask for more, so it had to guess high. With a cursor the
 * first window only has to fill a screen.
 */
export const QUEUE_PAGE = 25

type Cursor = { c: string; i: string }

const NO_MATCH = '00000000-0000-0000-0000-000000000000'

/**
 * The shape this helper needs from a PostgREST query, and no more.
 *
 * Structural rather than the imported builder generic: the five queues select
 * five different column sets, so the concrete type differs at every call site
 * and naming it buys nothing the rows are not already cast for.
 */
type Pageable = {
  order(col: string, opts: { ascending: boolean }): Pageable
  limit(n: number): Pageable
  or(filter: string): Pageable
  then: PromiseLike<{ data: unknown[] | null; count: number | null }>['then']
}

/** Applies the keyset ordering, the cursor and the +1 look-ahead. */
async function keysetPage<T extends Record<string, unknown>>(
  build: () => Pageable,
  { orderCol, cursor, limit }: { orderCol: string; cursor?: string | null; limit: number },
): Promise<{ page: T[]; nextCursor: string | null; total: number }> {
  let query = build()
    .order(orderCol, { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  const after = decodeCursor<Cursor>(cursor ?? null)
  if (after) {
    query = query.or(
      `${orderCol}.lt.${after.c},and(${orderCol}.eq.${after.c},id.lt.${after.i})`,
    )
  }

  const { data, count } = await query
  const all = (data ?? []) as T[]
  const hasMore = all.length > limit
  const page = hasMore ? all.slice(0, limit) : all
  const last = page[page.length - 1]

  return {
    page,
    nextCursor:
      hasMore && last
        ? encodeCursor({ c: String(last[orderCol]), i: String(last.id) })
        : null,
    total: count ?? 0,
  }
}

// --------------------------------------------------------------- tutors ----

export type QueueTutorRow = {
  id: string
  fullName: string
  email: string
  headline: string | null
  city: string | null
  area: string | null
  avatarUrl: string | null
  videoYoutubeId: string | null
  videoStatus: string
  videoVisibility: string
  videoAttempts: number
  verificationStatus: string
  ratingAvg: number
  ratingCount: number
  degrees: string[]
  completion: number
  cnicNumber: string | null
  phone: string | null
  documents: { id: string; kind: 'cnic' | 'degree'; label: string | null }[]
}

export async function loadTutorQueue({
  filter,
  cursor,
  limit = QUEUE_PAGE,
}: {
  filter: string
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueTutorRow[], nextCursor: null, total: 0 }

  const build = () => {
    let q = admin
      .from('tutor_profiles')
      .select(
        'id, full_name, email, headline, city, area, avatar_url, video_youtube_id, video_status, video_visibility, video_attempts, verification_status, rating_avg, rating_count, degrees, created_at',
        { count: 'exact' },
      )
    if (filter === 'pending') q = q.eq('video_status', 'uploaded')
    else if (filter === 'suspended') q = q.eq('verification_status', 'suspended')
    return q
  }

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const ids = page.map((t) => t.id as string)
  const [{ data: profiles }, { data: docs }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, profile_completion, cnic_number, phone_number')
      .in('id', ids.length ? ids : [NO_MATCH]),
    admin
      .from('user_documents')
      .select('id, user_id, kind, label')
      .in('user_id', ids.length ? ids : [NO_MATCH]),
  ])

  const rows: QueueTutorRow[] = page.map((t) => {
    const p = profiles?.find((x) => x.id === t.id)
    return {
      id: t.id as string,
      fullName: t.full_name as string,
      email: t.email as string,
      headline: (t.headline as string) ?? null,
      city: (t.city as string) ?? null,
      area: (t.area as string) ?? null,
      avatarUrl: (t.avatar_url as string) ?? null,
      videoYoutubeId: (t.video_youtube_id as string) ?? null,
      videoStatus: (t.video_status as string) ?? 'none',
      videoVisibility: (t.video_visibility as string) ?? 'private',
      videoAttempts: (t.video_attempts as number) ?? 0,
      verificationStatus: (t.verification_status as string) ?? 'pending',
      ratingAvg: Number(t.rating_avg ?? 0),
      ratingCount: (t.rating_count as number) ?? 0,
      degrees: ((t.degrees as string[]) ?? []) as string[],
      completion: (p?.profile_completion as number) ?? 0,
      cnicNumber: (p?.cnic_number as string) ?? null,
      phone: (p?.phone_number as string) ?? null,
      documents: (docs ?? [])
        .filter((d) => d.user_id === t.id)
        .map((d) => ({
          id: d.id as string,
          kind: d.kind as 'cnic' | 'degree',
          label: (d.label as string) ?? null,
        })),
    }
  })

  return { rows, nextCursor, total }
}

// --------------------------------------------------------------- parents ---

export type QueueParentRow = {
  id: string
  fullName: string
  email: string
  city: string | null
  address: string | null
  cnicNumber: string | null
  phone: string | null
  phoneVerified: boolean
  state: string
  submittedAt: string | null
  completion: number
  /**
   * Both sides of the card, newest first per side.
   *
   * Was a single `cnicDocumentId`. A verifier comparing a typed number against
   * a photograph needs the side the number is printed on, and the queue was
   * showing whichever document happened to sort first -- so a parent who
   * uploaded the back last had their back photo shown as "the CNIC" with no
   * number visible on it at all.
   */
  cnicFrontId: string | null
  cnicBackId: string | null
}

export async function loadParentQueue({
  filter,
  cursor,
  limit = QUEUE_PAGE,
}: {
  filter: string
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueParentRow[], nextCursor: null, total: 0 }

  const build = () => {
    let q = admin
      .from('profiles')
      .select(
        'id, full_name, email, city, address, cnic_number, phone_number, phone_verified_at, verification_state, verification_submitted_at, cnic_verified_at, address_verified_at, profile_completion, created_at',
        { count: 'exact' },
      )
      .in('role', ['parent', 'academy'])
    if (filter === 'submitted') q = q.eq('verification_state', 'submitted')
    else if (filter === 'approved') q = q.eq('verification_state', 'approved')
    return q
  }

  // Ordered by created_at rather than the old verification_submitted_at: a
  // nullable column cannot key a cursor -- every unsubmitted parent shares the
  // value NULL, which no comparison can order or resume from.
  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const ids = page.map((p) => p.id as string)
  const { data: docs } = await admin
    .from('user_documents')
    .select('id, user_id, kind, label, created_at')
    .eq('kind', 'cnic')
    .in('user_id', ids.length ? ids : [NO_MATCH])
    .order('created_at', { ascending: false })

  const rows: QueueParentRow[] = page.map((p) => ({
    id: p.id as string,
    fullName: p.full_name as string,
    email: p.email as string,
    city: (p.city as string) ?? null,
    address: (p.address as string) ?? null,
    cnicNumber: (p.cnic_number as string) ?? null,
    phone: (p.phone_number as string) ?? null,
    phoneVerified: Boolean(p.phone_verified_at),
    state: (p.verification_state as string) ?? 'none',
    submittedAt: (p.verification_submitted_at as string) ?? null,
    completion: (p.profile_completion as number) ?? 0,
    // A row written before the front/back split has no label and is the front:
    // that is what the single uploader asked for, in copy that said "the front
    // of the card".
    cnicFrontId:
      (docs?.find((d) => d.user_id === p.id && (d.label as string | null) !== 'back')
        ?.id as string) ?? null,
    cnicBackId:
      (docs?.find((d) => d.user_id === p.id && (d.label as string | null) === 'back')
        ?.id as string) ?? null,
  }))

  return { rows, nextCursor, total }
}

// -------------------------------------------------------------- payments ---

export type QueuePaymentRow = {
  id: string
  userId: string
  name: string
  email: string
  planCode: string
  planName: string
  amountPkr: number
  provider: string
  method: string | null
  ourReference: string | null
  payerReference: string | null
  cameFrom: string | null
  hasScreenshot: boolean
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason: string | null
  createdAt: string
  reviewedAt: string | null
}

export async function loadPaymentQueue({
  filter,
  cursor,
  limit = QUEUE_PAGE,
}: {
  filter: string
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueuePaymentRow[], nextCursor: null, total: 0 }

  const build = () => {
    let q = admin
      .from('payments')
      .select(
        'id, user_id, plan_code, amount_pkr, method, provider, provider_ref, reference, screenshot_path, status, rejection_reason, reviewed_at, created_at, utm_source, utm_medium, utm_campaign',
        { count: 'exact' },
      )
    if (filter !== 'all') q = q.eq('status', filter)
    return q
  }

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const userIds = Array.from(new Set(page.map((p) => p.user_id as string)))
  const [{ data: profiles }, { data: plans }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, email, role')
      .in('id', userIds.length ? userIds : [NO_MATCH]),
    admin.from('plans').select('code, name'),
  ])

  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))
  const who = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string) ?? '—', email: (p.email as string) ?? '—' },
    ]),
  )

  const rows: QueuePaymentRow[] = page.map((p) => ({
    id: p.id as string,
    userId: p.user_id as string,
    name: who.get(p.user_id as string)?.name ?? '—',
    email: who.get(p.user_id as string)?.email ?? '—',
    planCode: (p.plan_code as string) ?? '—',
    planName: planName.get(p.plan_code as string) ?? ((p.plan_code as string) ?? '—'),
    amountPkr: p.amount_pkr as number,
    provider: p.provider as string,
    method: (p.method as string) ?? null,
    ourReference: (p.provider_ref as string) ?? null,
    payerReference: (p.reference as string) ?? null,
    cameFrom: describeUtm(p as Parameters<typeof describeUtm>[0]),
    hasScreenshot: !!p.screenshot_path,
    status: p.status as QueuePaymentRow['status'],
    rejectionReason: (p.rejection_reason as string) ?? null,
    createdAt: p.created_at as string,
    reviewedAt: (p.reviewed_at as string) ?? null,
  }))

  return { rows, nextCursor, total }
}

// --------------------------------------------------------------- reports ---

export type QueueReportRow = {
  id: string
  reporterId: string | null
  reporterName: string
  reportedId: string | null
  reportedName: string | null
  reportedRole: string | null
  reportedSuspended: boolean
  targetType: string
  targetId: string | null
  reason: string
  detail: string | null
  status: 'open' | 'actioned' | 'dismissed'
  actionTaken: string | null
  resolutionNote: string | null
  createdAt: string
  reviewedAt: string | null
  messages: { who: string; body: string; at: string }[] | null
}

export async function loadReportQueue({
  filter,
  cursor,
  limit = QUEUE_PAGE,
}: {
  filter: string
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueReportRow[], nextCursor: null, total: 0 }

  const build = () => {
    let q = admin
      .from('reports')
      .select(
        'id, reporter_id, reported_id, target_type, target_id, reason, detail, status, action_taken, resolution_note, reviewed_at, created_at',
        { count: 'exact' },
      )
    if (filter !== 'all') q = q.eq('status', filter)
    return q
  }

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const ids = Array.from(
    new Set(
      page.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean) as string[],
    ),
  )

  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name, email, role, is_suspended')
    .in('id', ids.length ? ids : [NO_MATCH])

  const who = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      {
        name: (p.full_name as string) ?? '—',
        role: p.role as string,
        suspended: !!p.is_suspended,
      },
    ]),
  )

  // THE PRIVACY LINE. Message bodies are loaded only for reports whose target
  // IS a thread, and only for the threads on this page. There is no input
  // anywhere on the reports screen that could ask for any other conversation,
  // and the member timeline never carries a body at all.
  const threadIds = Array.from(
    new Set(
      page
        .filter((r) => r.target_type === 'thread' && r.target_id)
        .map((r) => r.target_id as string)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  )

  const messagesByThread = new Map<string, { senderId: string; body: string; at: string }[]>()
  if (threadIds.length > 0) {
    const { data: msgs } = await admin
      .from('messages')
      .select('thread_id, sender_id, body, created_at')
      .in('thread_id', threadIds)
      .order('created_at')
      .limit(400)

    for (const m of msgs ?? []) {
      const k = m.thread_id as string
      if (!messagesByThread.has(k)) messagesByThread.set(k, [])
      messagesByThread.get(k)!.push({
        senderId: m.sender_id as string,
        body: m.body as string,
        at: m.created_at as string,
      })
    }
  }

  const rows: QueueReportRow[] = page.map((r) => {
    const reportedId = (r.reported_id as string) ?? null
    return {
      id: r.id as string,
      reporterId: (r.reporter_id as string) ?? null,
      reporterName: r.reporter_id
        ? (who.get(r.reporter_id as string)?.name ?? '—')
        : 'Deleted account',
      reportedId,
      reportedName: reportedId ? (who.get(reportedId)?.name ?? '—') : null,
      reportedRole: reportedId ? (who.get(reportedId)?.role ?? null) : null,
      reportedSuspended: reportedId ? !!who.get(reportedId)?.suspended : false,
      targetType: r.target_type as string,
      targetId: (r.target_id as string) ?? null,
      reason: r.reason as string,
      detail: (r.detail as string) ?? null,
      status: r.status as QueueReportRow['status'],
      actionTaken: (r.action_taken as string) ?? null,
      resolutionNote: (r.resolution_note as string) ?? null,
      createdAt: r.created_at as string,
      reviewedAt: (r.reviewed_at as string) ?? null,
      messages:
        r.target_type === 'thread' && r.target_id
          ? (messagesByThread.get(r.target_id as string) ?? []).map((m) => ({
              who: who.get(m.senderId)?.name ?? 'Member',
              body: m.body,
              at: m.at,
            }))
          : null,
    }
  })

  return { rows, nextCursor, total }
}

// ------------------------------------------------------------------- ads ---

export type QueueAdRow = {
  id: string
  title: string
  clientName: string | null
  description: string | null
  imageUrl: string | null
  targetUrl: string | null
  audience: 'parents' | 'tutors' | 'both'
  startsAt: string
  endsAt: string | null
  weight: number
  status: 'active' | 'paused' | 'archived'
  impressions: number
  clicks: number
  live: boolean
  expired: boolean
}

export async function loadAdList({
  cursor,
  limit = QUEUE_PAGE,
}: {
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueAdRow[], nextCursor: null, total: 0 }

  const build = () =>
    admin
      .from('advertisements')
      .select(
        'id, title, client_name, description, image_path, target_url, audience, starts_at, ends_at, weight, status, impressions, clicks, created_at',
        { count: 'exact' },
      )

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const now = Date.now()
  const rows: QueueAdRow[] = page.map((a) => {
    const starts = new Date(a.starts_at as string).getTime()
    const ends = a.ends_at ? new Date(a.ends_at as string).getTime() : null
    return {
      id: a.id as string,
      title: a.title as string,
      clientName: (a.client_name as string) || null,
      description: (a.description as string) || null,
      imageUrl: a.image_path ? publicAdUrl(a.image_path as string) : null,
      targetUrl: (a.target_url as string) ?? null,
      audience: a.audience as QueueAdRow['audience'],
      startsAt: a.starts_at as string,
      endsAt: (a.ends_at as string) ?? null,
      weight: a.weight as number,
      status: a.status as QueueAdRow['status'],
      impressions: Number(a.impressions ?? 0),
      clicks: Number(a.clicks ?? 0),
      // "Live" is the state that matters and it is not a column: an ad is in
      // rotation only if it is active AND inside its window.
      live: a.status === 'active' && starts <= now && (ends === null || ends > now),
      expired: ends !== null && ends <= now,
    }
  })

  return { rows, nextCursor, total }
}

// -------------------------------------------------- subscriptions (ledger) --

export type QueueSubscriptionRow = {
  id: string
  name: string
  email: string
  role: string
  planName: string
  status: string
  startsAt: string
  expiresAt: string | null
  source: string
  note: string | null
}

/** gateway / manual transfer / admin grant, derived not stored. */
function describeSource(source: string, provider: string | undefined): string {
  if (source === 'admin_grant') return 'Admin grant'
  if (provider === 'manual') return 'Manual transfer'
  if (provider === 'simulator') return 'Gateway (test)'
  if (provider === 'assanpay') return 'Gateway'
  return 'Purchase'
}

export async function loadSubscriptionLedger({
  cursor,
  limit = QUEUE_PAGE,
}: {
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueSubscriptionRow[], nextCursor: null, total: 0 }

  const build = () =>
    admin
      .from('subscriptions')
      .select('id, user_id, plan_code, status, starts_at, expires_at, source, payment_id, note', {
        count: 'exact',
      })

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'starts_at',
    cursor,
    limit,
  })

  const userIds = Array.from(new Set(page.map((s) => s.user_id as string)))
  const paymentIds = Array.from(
    new Set(page.map((s) => s.payment_id as string | null).filter(Boolean) as string[]),
  )

  const [{ data: profiles }, { data: plans }, { data: payments }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, email, role')
      .in('id', userIds.length ? userIds : [NO_MATCH]),
    admin.from('plans').select('code, name'),
    admin
      .from('payments')
      .select('id, provider')
      .in('id', paymentIds.length ? paymentIds : [NO_MATCH]),
  ])

  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))
  const who = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: (p.full_name as string) ?? '—',
        email: (p.email as string) ?? '—',
        role: p.role as string,
      },
    ]),
  )
  // "Source" is not a column on subscriptions. It is read from the payment the
  // subscription points at, because that is where the fact lives -- a row with
  // source='purchase' and a manual payment behind it WAS a bank transfer, and
  // storing that twice is how the two answers start disagreeing.
  const provider = new Map((payments ?? []).map((p) => [p.id as string, p.provider as string]))

  const rows: QueueSubscriptionRow[] = page.map((s) => ({
    id: s.id as string,
    name: who.get(s.user_id as string)?.name ?? '—',
    email: who.get(s.user_id as string)?.email ?? '—',
    role: who.get(s.user_id as string)?.role ?? '—',
    planName: planName.get(s.plan_code as string) ?? (s.plan_code as string),
    status: s.status as string,
    startsAt: s.starts_at as string,
    expiresAt: (s.expires_at as string) ?? null,
    source: describeSource(s.source as string, provider.get(s.payment_id as string)),
    note: (s.note as string) ?? null,
  }))

  return { rows, nextCursor, total }
}

// ------------------------------------------------------------ user blocks --

export type QueueBlockRow = {
  id: string
  blockerId: string
  blockerName: string
  blockedId: string
  blockedName: string
  createdAt: string
}

export async function loadBlockList({
  cursor,
  limit = QUEUE_PAGE,
}: {
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as QueueBlockRow[], nextCursor: null, total: 0 }

  const build = () =>
    admin.from('user_blocks').select('id, blocker_id, blocked_id, created_at', { count: 'exact' })

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const ids = Array.from(
    new Set(page.flatMap((b) => [b.blocker_id, b.blocked_id]).filter(Boolean) as string[]),
  )
  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', ids.length ? ids : [NO_MATCH])

  const name = new Map(
    (people ?? []).map((p) => [p.id as string, (p.full_name as string) ?? '—']),
  )

  const rows: QueueBlockRow[] = page.map((b) => ({
    id: b.id as string,
    blockerId: b.blocker_id as string,
    blockerName: name.get(b.blocker_id as string) ?? '—',
    blockedId: b.blocked_id as string,
    blockedName: name.get(b.blocked_id as string) ?? '—',
    createdAt: b.created_at as string,
  }))

  return { rows, nextCursor, total }
}

// -------------------------------------------------------- member timeline --

export type TimelineRowData = {
  id: string
  event: string
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown>
  at: string
}

/**
 * One member's activity, newest first.
 *
 * PRIVACY, restated where the query lives: `meta` never contains a message
 * body -- lib/activityLog.ts refuses to put one there -- so a message event is
 * a thread reference and nothing else. There is no path from this data to a
 * conversation; reading one requires a report that names it.
 */
export async function loadMemberTimeline({
  userId,
  group,
  cursor,
  limit = QUEUE_PAGE,
}: {
  userId: string
  group: string
  cursor?: string | null
  limit?: number
}) {
  const admin = createAdminClient()
  if (!admin) return { rows: [] as TimelineRowData[], nextCursor: null, total: 0 }

  const build = () => {
    let q = admin
      .from('user_activity_log')
      .select('id, event, target_type, target_id, meta, created_at', { count: 'exact' })
      .eq('user_id', userId)
    const events = TIMELINE_GROUPS[group]
    if (events) q = q.in('event', events)
    return q
  }

  const { page, nextCursor, total } = await keysetPage<Record<string, unknown>>(build, {
    orderCol: 'created_at',
    cursor,
    limit,
  })

  const rows: TimelineRowData[] = page.map((a) => ({
    id: a.id as string,
    event: a.event as string,
    targetType: (a.target_type as string) ?? null,
    targetId: (a.target_id as string) ?? null,
    meta: (a.meta as Record<string, unknown>) ?? {},
    at: a.created_at as string,
  }))

  return { rows, nextCursor, total }
}
