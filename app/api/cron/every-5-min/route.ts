import { NextResponse } from 'next/server'
import { drainIndexingQueue, INDEXING_DAILY_LIMIT } from '@/lib/googleIndexing'
import { timingSafeEqual } from 'node:crypto'
import { publishDuePosts } from '@/lib/blogPublish'
import { sweepTutorAlerts } from '@/lib/tutorAlerts'
import { runBankReader } from '@/lib/bankEmailReader'
import { endExpiredViews } from '@/lib/viewAs'
import { refreshStatementMatches } from '@/lib/bankStatement'
import { runAddressBackfill } from '@/lib/cnicAddress'
import { runInterestBackfill } from '@/lib/parentInterest'
import { refreshInsights } from '@/lib/insights'
import { generateFeaturedItems } from '@/lib/featuredMatches'

// The 5-minute jobs: due blog posts, Indexing API notices, tutor alerts, the
// bank reader, View-as expiry, statement matches and the backfills. It used to
// re-check pending PayPro orders too; PayPro has ended (PR-12), so it no longer
// does.
//
// Protected by CRON_SECRET (the subscriptions-cron pattern): refuses every
// request when the secret is unset, and compares in constant time. GET, because
// that is what Vercel Cron issues.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const t0 = Date.now()
  // Scheduled blog posts go live within five minutes (owner, 5 Oct 2026): this
  // is the only frequent cron, so it also runs the due-post sweep, independent
  // of PayPro being configured. The daily cron keeps its own call as a backstop.
  const blog = await publishDuePosts().catch((e: unknown) => ({ published: 0, slugs: [], errors: [e instanceof Error ? e.message : 'failed'] }))
  // Google Indexing API notices (owner, 8 Oct 2026): drained here, a few at a
  // time, never past 200 in a UTC day; anything over waits for the next day.
  const indexing = await drainIndexingQueue(INDEXING_DAILY_LIMIT, 20_000).catch(() => ({ sent: 0, failed: 0, left: -1 }))
  // "Notify me when a matching tutor joins": one message per request, then closed.
  const alerts = await sweepTutorAlerts().catch(() => ({ open: 0, sent: 0, expired: 0, failed: 0 }))
  // The Faysal Bank email reader (owner, 26 Oct 2026): does nothing while the
  // Owner's switch is off. Counts only in the reply — never an email or a value.
  const bankReader = await runBankReader()
    .then((r) => (r.ran ? { status: r.status, ...(r.result && r.result.status === 'ok' ? { added: r.result.added, read: r.result.read } : {}) } : { status: r.why }))
    .catch(() => ({ status: 'error' }))
  // "View as" (owner, 26 Oct 2026): a view whose 30 minutes ran out is ended
  // here even when the browser never comes back.
  const viewAsEnded = await endExpiredViews().catch(() => 0)
  // Bank statement matches (PR-03): a receipt uploaded after an import becomes
  // Bank-matched within 5 minutes. Counts only.
  const statement = await refreshStatementMatches().catch(() => null)
  // CNIC address backfill (PR-07): a few approved CNIC backs of members with no
  // address are read into unconfirmed suggestions; each image once, so it ends
  // by itself. Counts only — never an address.
  const addressBackfill = await runAddressBackfill({ limit: 12, deadlineMs: t0 + 30_000 }).catch(() => null)
  // Parent-interest backfill (PR-08): once — the last 30 days of shortlists,
  // parent-started conversations and demo requests become events; marked done
  // in app_settings so later runs return at once. Counts only.
  const interestBackfill = await runInterestBackfill().then((r) => (r.ran ? r : null)).catch(() => null)
  // Admin → Insights (PR-12): keep the last month of days built — today every
  // 10 minutes, a few other days per run, inside what is left of the minute.
  // Tutor Featured (PR-14): once a Pakistan day from 08:00 PKT, one Featured —
  // matched tuitions item per Featured tutor with new matches (People →
  // WhatsApp updates → Today). Before Insights, so it never waits on it.
  const featured = await generateFeaturedItems().then((r) => (r.ran ? r : null)).catch(() => null)
  const insights = await refreshInsights(Date.now(), t0 + 50_000).catch(() => null)
  // PayPro has ended (PR-12, 20 Nov 2026): no order is re-checked at PayPro any
  // more and nothing activates from it, so this job no longer reads a PAYPRO_*
  // setting or touches a PayPro payment row.
  return NextResponse.json({ ok: true, paypro: 'ended', blog, indexing, alerts, bankReader, viewAsEnded, statement, addressBackfill, interestBackfill, featured, insights })
}
