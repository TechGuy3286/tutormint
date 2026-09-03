import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import {
  loadAdList,
  loadBlockList,
  loadParentQueue,
  loadPaymentQueue,
  loadMemberTimeline,
  loadReportQueue,
  loadSubscriptionLedger,
  loadTutorQueue,
  QUEUE_PAGE,
  QUEUE_SCREEN,
  type QueueKind,
} from '@/lib/adminQueues'

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

type Args = { filter: string; cursor: string | null; params: URLSearchParams }

const LOADERS: Record<QueueKind, (args: Args) => Promise<{
  rows: unknown[]
  nextCursor: string | null
  total: number
}>> = {
  tutors: ({ filter, cursor }) => loadTutorQueue({ filter, cursor, limit: QUEUE_PAGE }),
  parents: ({ filter, cursor }) => loadParentQueue({ filter, cursor, limit: QUEUE_PAGE }),
  payments: ({ filter, cursor }) => loadPaymentQueue({ filter, cursor, limit: QUEUE_PAGE }),
  subscriptions: ({ cursor }) => loadSubscriptionLedger({ cursor, limit: QUEUE_PAGE }),
  reports: ({ filter, cursor }) => loadReportQueue({ filter, cursor, limit: QUEUE_PAGE }),
  blocks: ({ cursor }) => loadBlockList({ cursor, limit: QUEUE_PAGE }),
  ads: ({ cursor }) => loadAdList({ cursor, limit: QUEUE_PAGE }),
  // The one list scoped to a subject rather than to a filter. `userId` comes
  // from the query string and is used only as an equality on user_id -- the
  // permission that matters is SCREEN_ACCESS.users, checked above, because an
  // admin who may open the member directory may read any member's timeline.
  timeline: ({ cursor, params }) =>
    loadMemberTimeline({
      userId: params.get('userId') ?? '',
      group: params.get('group') ?? 'all',
      cursor,
      limit: QUEUE_PAGE,
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
    cursor: url.searchParams.get('cursor'),
    params: url.searchParams,
  })

  return NextResponse.json({ items: rows, cursor: nextCursor })
}
