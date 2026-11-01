import { NextResponse } from 'next/server'

import { RETIRED_API_MESSAGE } from '@/lib/retiredAdminCore'

// The answer a retired admin API route gives (owner, 31 Oct 2026): 410 Gone,
// nothing read or written. The feature's data stays in the database.
export function retiredApi(): NextResponse {
  return NextResponse.json({ error: RETIRED_API_MESSAGE, retired: true }, { status: 410, headers: { 'cache-control': 'no-store' } })
}
