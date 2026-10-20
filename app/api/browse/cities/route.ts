import { NextResponse } from 'next/server'
import { browseCitiesCached } from '@/lib/browseCities'

// GET /api/browse/cities — the cities that have an open tuition or a listed
// tutor right now (owner, 20 Oct 2026), for the Browse city filters. Public:
// names only, nothing about anyone.

export const dynamic = 'force-dynamic'

export async function GET() {
  const cities = await browseCitiesCached().catch(() => [] as string[])
  return NextResponse.json({ cities }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' } })
}
