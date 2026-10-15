import { redirect } from 'next/navigation'

import { paidListHref, parsePayerPeriod } from '@/lib/overviewItemsCore'

// Payments → Recent payers was retired (owner, 15 Oct 2026). The Overview
// "Paid today" list now has a period switch with the same rule (approved
// Verification Fee, not refunded, account kept, one row per tutor). This
// address redirects there: with ?period=… to that period, otherwise to "This
// month" — Recent payers was opened from the "Paid this month" tile. The list
// page checks the role (SCREEN_ACCESS.payments, as Recent payers did).

export const dynamic = 'force-dynamic'

export default async function RecentPayersMoved({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams
  redirect(paidListHref(sp.period ? parsePayerPeriod(sp.period) : 'month'))
}
