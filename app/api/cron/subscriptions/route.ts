import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { runSubscriptionSweep } from '@/lib/payments/expiry'
import { publishDuePosts } from '@/lib/blogPublish'
import { rebuildContentQueue } from '@/lib/contentQueue/build'
import { deliverContentDigest } from '@/lib/contentQueue/digest'

// Daily subscription sweep: remind at T-3, expire at zero.
//
// Protected by CRON_SECRET. Vercel Cron sends it as `Authorization: Bearer
// <CRON_SECRET>`; the same header works for a manual run. When CRON_SECRET is
// unset the route refuses every request rather than running open -- an
// unprotected endpoint that expires subscriptions is a denial-of-service
// anyone can point at paying members.
//
// GET, because that is what Vercel Cron issues. It is not read-only, but it IS
// idempotent, which is the property that actually matters here: reminders are
// guarded by reminded_at and expiry by status, so running it twice does
// nothing the second time.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The nightly content-queue rebuild reads several tables and upserts dozens of
// rows on top of the billing sweep; 60s gives the whole tick room.
export const maxDuration = 60

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header

  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function handle(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  const result = await runSubscriptionSweep()

  // The blog's scheduled-publish sweep rides the same daily cron. Independent
  // of the subscription result — a blog error must not look like a billing one,
  // and vice versa — but its errors are surfaced the same way.
  const blog = await publishDuePosts()

  // The content queue is rebuilt nightly (CLAUDE.md 9.4), and the Monday digest
  // rides the same tick — it sends only on Monday and only once a day, so on
  // every other day deliverContentDigest is a cheap no-op. Both are wrapped so a
  // queue error cannot fail the billing sweep.
  const queue = await rebuildContentQueue().catch((e) => ({ errors: [String(e)] }) as { errors: string[] })
  const digest = await deliverContentDigest().catch((e) => ({ sent: false, recipients: 0, reason: String(e) }))

  // Errors are reported, not swallowed: a sweep that silently half-ran is how
  // a member keeps a plan they stopped paying for.
  const errors = [...result.errors, ...blog.errors, ...('errors' in queue ? queue.errors : [])]
  const status = errors.length > 0 ? 500 : 200
  return NextResponse.json(
    {
      ok: errors.length === 0,
      ...result,
      blog: { published: blog.published, slugs: blog.slugs, errors: blog.errors },
      queue,
      digest,
    },
    { status },
  )
}

export const GET = handle
export const POST = handle
