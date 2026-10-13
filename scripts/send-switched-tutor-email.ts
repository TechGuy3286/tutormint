/**
 * scripts/send-switched-tutor-email.ts — one-time (owner, 13 Oct 2026).
 *
 * Sends ONE email, "You can now sign in to TutorMint", to each email-only tutor
 * who was switched on 13 Oct 2026 (scripts/dataop-open-email-tutors.ts) and was
 * never told. The rules live in lib/switchedTutorEmailCore: skipped are tutors
 * who have since verified a mobile, are paused or banned, or are test or staff
 * accounts. Each send is recorded first (one_off_emails, unique per member), so
 * a second run cannot send twice.
 *
 * The Resend key exists only in production, so this calls the
 * CRON_SECRET-protected route there. It prints COUNTS ONLY — no name, no
 * address.
 *
 *   npx tsx --env-file=.env.local scripts/send-switched-tutor-email.ts --dry-run   (sends nothing, writes nothing)
 *   npx tsx --env-file=.env.local scripts/send-switched-tutor-email.ts --send
 */
const SITE = process.env.SWITCHED_EMAIL_SITE_URL || 'https://www.tutormint.org'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const send = process.argv.includes('--send')
  if (dryRun === send) throw new Error('Pass exactly one of --dry-run or --send.')
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set (needed to call the production route).')

  const res = await fetch(`${SITE}/api/internal/switched-tutor-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ dryRun }),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`route answered ${res.status}: ${String(data.error ?? '')}`)

  const skipped = (data.skipped ?? {}) as Record<string, number>
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0)
  console.log(dryRun ? 'DRY RUN — nothing sent, nothing written.' : 'SENT.')
  console.log(`switched tutors: ${data.candidates}`)
  console.log(dryRun ? `would send: ${data.wouldSend}` : `sent: ${data.sent}   failed: ${data.failed}`)
  console.log(`skipped: ${skippedTotal}  ${JSON.stringify(skipped)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
