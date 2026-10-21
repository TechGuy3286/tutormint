import { NextResponse } from 'next/server'

import { checkAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import {
  loadAdList,
  loadBlockList,
  loadParentQueue,
  loadPaymentQueue,
  withoutAmounts,
  loadReportQueue,
  loadSubscriptionLedger,
  loadTutorQueue,
  QUEUE_PAGE,
  QUEUE_SCREEN,
  type QueueKind,
} from '@/lib/adminQueues'
import { loadUnifiedTimeline } from '@/lib/memberTimeline'
import { parseTimelineGroup } from '@/lib/memberTimelineCore'
import type { AdminRole } from '@/lib/adminAccessCore'

// The "and then some more" half of every admin list that used to end at a
// hard cap.
//
// PERMISSION IS RE-CHECKED PER KIND, from the same QUEUE_SCREEN table the
// screens read. The kind is in the path, so a support admin who can open
// /admin/reports cannot fetch /api/admin/queues/payments by changing one word:
// the check is done against the entry for the kind that was asked for, not
// against whatever the caller happened to be allowed to see last.
//
// AN UNKNOWN KIND IS A 404, not a 403 -- there is no queue to be refused
// access to. Answering 403 for a name that does not exist would make this
// route a way to enumerate which queues exist.

export const dynamic = 'force-dynamic'

type Args = { filter: string; search: string; cursor: string | null; params: URLSearchParams; role: AdminRole }

const LOADERS: Record<QueueKind, (args: Args) => Promise<{
  rows: unknown[]
  nextCursor: string | null
  total: number
}>> = {
  tutors: ({ filter, search, cursor }) =>
    loadTutorQueue({ filter, search, cursor, limit: QUEUE_PAGE }),
  parents: ({ filter, cursor }) => loadParentQueue({ filter, cursor, limit: QUEUE_PAGE }),
  payments: ({ filter, search, cursor, params }) =>
    loadPaymentQueue({ filter, search, cursor, limit: QUEUE_PAGE, showHidden: params.get('hidden') === '1' }),
  subscriptions: ({ cursor }) => loadSubscriptionLedger({ cursor, limit: QUEUE_PAGE }),
  reports: ({ filter, cursor }) => loadReportQueue({ filter, cursor, limit: QUEUE_PAGE }),
  blocks: ({ cursor }) => loadBlockList({ cursor, limit: QUEUE_PAGE }),
  ads: ({ cursor }) => loadAdList({ cursor, limit: QUEUE_PAGE }),
  // The one list scoped to a subject rather than to a filter. `userId` comes
  // from the query string and is used only as an equality on user_id -- the
  // permission that matters is SCREEN_ACCESS.users, checked above, because an
  // admin who may open the member directory may read any member's timeline.
  // ONE merged timeline (owner, 20 Oct 2026): the cursor is a position in the
  // grouped list. Visits (sessions and pages) only for owner/admin/Partner, as
  // the old Activity box was.
  timeline: ({ cursor, params, role }) =>
    loadUnifiedTimeline({
      userId: params.get('userId') ?? '',
      group: parseTimelineGroup(params.get('group')),
      offset: Number(cursor) || 0,
      withVisits: roleSatisfies(role, ['admin']),
    }),
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params
  if (!(kind in LOADERS)) {
    return NextResponse.json({ error: 'No such queue.' }, { status: 404 })
  }
  const queue = kind as QueueKind

  const gate = await checkAdminRole(...QUEUE_SCREEN[queue])
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const { rows, nextCursor } = await LOADERS[queue]({
    filter: url.searchParams.get('filter') ?? 'all',
    search: url.searchParams.get('search') ?? '',
    cursor: url.searchParams.get('cursor'),
    params: url.searchParams,
    role: gate.actor.adminRole,
  })

  // Payment amounts only for the owner and the Partner (owner, 8 Oct 2026).
  const items =
    queue === 'payments' && !roleSatisfies(gate.actor.adminRole, SCREEN_ACCESS.paymentAmounts)
      ? withoutAmounts(rows as Parameters<typeof withoutAmounts>[0], {
          keepAwaiting: roleSatisfies(gate.actor.adminRole, SCREEN_ACCESS.paymentsApprove),
        })
      : rows
  return NextResponse.json({ items, cursor: nextCursor })
}
