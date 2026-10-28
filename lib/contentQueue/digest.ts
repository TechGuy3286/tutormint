// lib/contentQueue/digest.ts
//
// The Monday content digest (owner, 28 Oct 2026): an email to the OWNER with
// three topics from real searches — each with "N searches last month" and one
// plain line on why — and any posts due a refresh. No priority numbers. Nothing auto-publishes — the
// email points at the queue and a human decides.
//
// Server-only. Runs from the daily cron; sends only on Monday (Asia/Karachi),
// and only once per day, guarded by an app_settings timestamp so a re-run of
// the idempotent cron does not send twice.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmailBulk } from '@/lib/notify'
import { notify } from '@/lib/notifications'
import { listSuggestions, postsDueForRefresh } from './feed'
import { loadSearchTopics } from './searchTopicsServer'
import { digestItems } from './digestCore'

const LAST_SENT_KEY = 'content_digest_last_sent'

/** The date in Asia/Karachi as YYYY-MM-DD, and whether it is a Monday. */
function karachiToday(now: Date): { date: string; isMonday: boolean } {
  // en-CA gives YYYY-MM-DD; weekday in the same zone avoids a UTC-vs-local slip.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'long' }).format(now)
  return { date, isMonday: weekday === 'Monday' }
}

export type DigestResult = { sent: boolean; recipients: number; reason?: string }

export async function deliverContentDigest(now = new Date(), force = false): Promise<DigestResult> {
  const admin = createAdminClient()
  if (!admin) return { sent: false, recipients: 0, reason: 'no service-role client' }

  const { date, isMonday } = karachiToday(now)
  if (!force && !isMonday) return { sent: false, recipients: 0, reason: 'not Monday' }

  // Once per day: a durable marker, because an in-process guard means one send
  // per lambda, which is not the promise.
  const { data: marker } = await admin.from('app_settings').select('value').eq('key', LAST_SENT_KEY).maybeSingle()
  if (!force && marker?.value === date) return { sent: false, recipients: 0, reason: 'already sent today' }

  const [{ content }, refresh, search] = await Promise.all([listSuggestions(), postsDueForRefresh(5), loadSearchTopics().catch(() => null)])
  // Google topics still open in the queue (not drafted, snoozed or dismissed).
  const openFps = new Set(content.map((s) => s.fingerprint))
  const google = (search?.topics ?? []).filter((t) => openFps.has(t.fingerprint))
  // Searches made on TutorMint itself: grouped topics with real search demand
  // (lib/contentQueue/topics: demand = 10 + searches).
  const site = content
    .filter((s) => s.source === 'search_gap' && s.components.demand > 10)
    .map((s) => ({ title: s.title, searches: Math.round(s.components.demand - 10), audience: s.audience }))
  const top = digestItems(google, site)
  const refreshItems = refresh.map((r) => ({ title: r.title, href: `/admin/blog/${r.id}` }))

  // The owner only (owner, 28 Oct 2026).
  const { data: staff } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(5)

  // One bulk run (owner, 16 Oct 2026): every list send goes through sendBulk.
  const results = await deliverEmailBulk(
    (staff ?? []).map((s) => ({
      to: { userId: s.id as string },
      input: { id: 'content_digest' as const, suggestions: top, refresh: refreshItems },
    })),
    'content_digest',
  )
  const recipients = results.filter((r) => r.ok).length
  // The bell (owner, 27 Oct 2026): the email is off by default for staff.
  for (const s of staff ?? []) {
    await notify({ userId: s.id as string, kind: 'staff_alert', title: 'This week’s blog suggestions', body: top[0]?.title ?? null, href: '/admin/blog/queue' }).catch(() => {})
  }

  // Stamp the marker even if a send failed: the point is not to retry-storm a
  // broken mailer at every cron tick. A missed digest is a smaller problem than
  // a daily one.
  await admin.from('app_settings').upsert({ key: LAST_SENT_KEY, value: date }, { onConflict: 'key' })

  return { sent: true, recipients }
}
