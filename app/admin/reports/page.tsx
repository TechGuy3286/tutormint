import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import ReportQueue, { type BlockRow, type QueueReport } from './ReportQueue'

// The reports queue. owner / manager / support.
//
// THE PRIVACY LINE. CLAUDE.md is explicit that there is no general
// chat-browsing screen: message content is admin-readable only through a report
// that names the thread. So thread bodies are loaded here, and only here, and
// only for reports whose target_type is 'thread' with a target_id. A report
// about a profile or a job carries no messages at all, however much an admin
// might want to see them -- there is no input on this page that would let one
// be requested.
//
// Bodies are shown raw rather than through lib/masking.ts. Masking exists to
// stop members trading contact details around the plan they paid for; a
// moderator judging a harassment report needs to see what was actually
// written, and the report is what authorises it.

export const dynamic = 'force-dynamic'

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.reports)
  const { filter = 'open' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so reports cannot be loaded.
      </p>
    )
  }

  let query = admin
    .from('reports')
    .select(
      'id, reporter_id, reported_id, target_type, target_id, reason, detail, status, action_taken, resolution_note, reviewed_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (filter !== 'all') query = query.eq('status', filter)

  const [{ data: reports }, { data: blocks }] = await Promise.all([
    query,
    admin
      .from('user_blocks')
      .select('id, blocker_id, blocked_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const ids = Array.from(
    new Set(
      [
        ...(reports ?? []).flatMap((r) => [r.reporter_id, r.reported_id]),
        ...(blocks ?? []).flatMap((b) => [b.blocker_id, b.blocked_id]),
      ].filter(Boolean) as string[],
    ),
  )

  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name, email, role, is_suspended')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

  const who = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      {
        name: (p.full_name as string) ?? '—',
        email: (p.email as string) ?? '—',
        role: p.role as string,
        suspended: !!p.is_suspended,
      },
    ]),
  )

  // ---- thread bodies, ONLY for reports that name a thread ------------------
  const threadIds = Array.from(
    new Set(
      (reports ?? [])
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

  const rows: QueueReport[] = (reports ?? []).map((r) => {
    const reportedId = r.reported_id as string | null
    return {
      id: r.id as string,
      reporterId: (r.reporter_id as string) ?? null,
      reporterName: r.reporter_id ? (who.get(r.reporter_id as string)?.name ?? '—') : 'Deleted account',
      reportedId,
      reportedName: reportedId ? (who.get(reportedId)?.name ?? '—') : null,
      reportedRole: reportedId ? (who.get(reportedId)?.role ?? null) : null,
      reportedSuspended: reportedId ? !!who.get(reportedId)?.suspended : false,
      targetType: r.target_type as string,
      targetId: (r.target_id as string) ?? null,
      reason: r.reason as string,
      detail: (r.detail as string) ?? null,
      status: r.status as QueueReport['status'],
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

  const blockRows: BlockRow[] = (blocks ?? []).map((b) => ({
    id: b.id as string,
    blockerId: b.blocker_id as string,
    blockerName: who.get(b.blocker_id as string)?.name ?? '—',
    blockedId: b.blocked_id as string,
    blockedName: who.get(b.blocked_id as string)?.name ?? '—',
    createdAt: b.created_at as string,
  }))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Reports</h1>
          <p className="text-xs text-gray-500">
            A reported conversation can be read here. Nowhere else.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#334155]"
        >
          Members
        </Link>
      </header>

      <ReportQueue reports={rows} blocks={blockRows} filter={filter} />
    </div>
  )
}
