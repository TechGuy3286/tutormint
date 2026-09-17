import { NextResponse } from 'next/server'

// Self-service mobile-number change — RETIRED (PR16 §3.2).
//
// One code per account, no expiry, no resend: a number change would need a new
// code, so number changes now go through SUPPORT, who verify manually from the
// admin drawer (§3.5). This route no longer changes anything; it answers with the
// support instruction so any stale caller gets a clear message rather than a 404.
// The "Wrong number?" UI that called it has been removed from /verify-phone and
// the completion flow.

export async function POST() {
  return NextResponse.json(
    { error: 'To change your mobile number, please contact support.' },
    { status: 403 },
  )
}
