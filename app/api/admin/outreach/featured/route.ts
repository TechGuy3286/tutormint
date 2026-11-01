import { retiredApi } from '@/lib/retiredApi'

// Retired on 31 Oct 2026 (owner-approved): this admin feature is off every
// screen and its route answers 410 Gone, changing nothing. Its data is kept.
// (lib/retiredAdminCore RETIRED_ADMIN_APIS)

export const dynamic = 'force-dynamic'

export async function GET() {
  return retiredApi()
}
export async function POST() {
  return retiredApi()
}
export async function PUT() {
  return retiredApi()
}
export async function PATCH() {
  return retiredApi()
}
export async function DELETE() {
  return retiredApi()
}
