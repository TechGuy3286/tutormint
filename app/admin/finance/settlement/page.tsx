import { redirect } from 'next/navigation'

import { financeHref } from '@/lib/financeTabsCore'

// Settlement check is part of the one Finance page (owner, 15 and 21 Oct 2026).
// The old address redirects there with its query kept (?month=…, ?from=…&to=…).

export const dynamic = 'force-dynamic'

export default async function SettlementMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(financeHref(await searchParams))
}
