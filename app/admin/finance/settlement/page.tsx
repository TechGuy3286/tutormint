import { redirect } from 'next/navigation'

import { financeHref } from '@/lib/financeTabsCore'

// Settlement check is now a tab of Finance (owner, 15 Oct 2026). The old
// address redirects there with its query kept (?month=…, ?from=…&to=…).

export const dynamic = 'force-dynamic'

export default async function SettlementMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(financeHref('settlement', await searchParams))
}
