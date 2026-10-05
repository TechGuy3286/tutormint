import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { createPublicClient } from '@/lib/supabase/public'
import { indexingConfigured, indexingClient, indexingClientEmail, tuitionUrl } from '@/lib/googleIndexing'
import { classifyTokenError, describeKeyShape } from '@/lib/googleIndexingCore'

// GET /api/internal/indexing-health — is the Google Indexing API set up?
// (owner, 5 Oct 2026). Protected by CRON_SECRET, the same `Authorization:
// Bearer <CRON_SECRET>` header the cron routes take; anyone without it gets 401.
//
// JSON only, no side effects, nothing written to the database:
//   configured  both env vars present
//   token       "ok", or a short plain word for the failure ("invalid key",
//               "wrong email", …) — never the key, never the token
//   metadata    the HTTP status of a READ-ONLY getMetadata call for one open
//               tuition URL (404 = Google has no notification history yet)
//   publish     the HTTP status of ONE URL_UPDATED notification for that same
//               URL — only with ?publish=1 (spends 1 of the 200 daily quota)
//   url         the tuition URL used
//   error       Google's error message text, if any (carries no secrets)
//
// Nothing here logs or returns any part of the private key or an access token.

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

/** The newest open tuition with a public page. Public (anon) read — no writes. */
async function sampleOpenTuitionUrl(): Promise<string | null> {
  try {
    const db = createPublicClient()
    const { data } = await db
      .from('jobs')
      .select('public_slug, city')
      .eq('status', 'open')
      .not('public_slug', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? tuitionUrl({ public_slug: data.public_slug as string, city: (data.city as string | null) ?? null }) : null
  } catch {
    return null
  }
}

type GoogleError = { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string; code?: number | string }

/** Google's status + message from a googleapis error, with nothing secret. */
function describe(e: unknown): { status: number | null; message: string } {
  const g = e as GoogleError
  const status = g.response?.status ?? (typeof g.code === 'number' ? g.code : null)
  const message = (g.response?.data?.error?.message ?? g.message ?? String(e)).slice(0, 300)
  return { status, message }
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  const publish = new URL(request.url).searchParams.get('publish') === '1'
  const configured = indexingConfigured()
  const url = await sampleOpenTuitionUrl()
  const out: Record<string, unknown> = {
    configured,
    clientEmail: indexingClientEmail(),
    token: configured ? 'not checked' : 'not configured',
    metadata: null as number | null,
    publish: publish ? null : 'not requested',
    url,
    error: null as string | null,
  }

  if (!configured) return NextResponse.json(out)

  const client = indexingClient()
  if (!client) return NextResponse.json(out)

  // 1. Token — signs the JWT and exchanges it. The token itself is never read
  //    back into the response.
  try {
    await client.auth.authorize()
    out.token = 'ok'
  } catch (e) {
    const d = describe(e)
    out.token = classifyTokenError(d.message)
    out.error = d.message
    // Shape facts only (lengths, markers, line count) — no key material — so a
    // mis-pasted key can be diagnosed without anyone reading it.
    out.keyShape = describeKeyShape(process.env.GOOGLE_INDEXING_PRIVATE_KEY)
    return NextResponse.json(out)
  }

  if (!url) {
    out.error = 'No open tuition with a public page to test against.'
    return NextResponse.json(out)
  }

  // 2. Read-only: getMetadata for the sample URL (404 = no history yet).
  try {
    const r = await client.indexing.urlNotifications.getMetadata({ url })
    out.metadata = r.status
  } catch (e) {
    const d = describe(e)
    out.metadata = d.status
    if (d.status !== 404) out.error = d.message
  }

  // 3. One URL_UPDATED, only on request.
  if (publish) {
    try {
      const r = await client.indexing.urlNotifications.publish({ requestBody: { url, type: 'URL_UPDATED' } })
      out.publish = r.status
    } catch (e) {
      const d = describe(e)
      out.publish = d.status
      out.error = d.message
    }
  }

  return NextResponse.json(out)
}
