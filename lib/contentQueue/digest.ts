// lib/contentQueue/digest.ts
//
// The Monday content digest: an email to owner and manager with the top three
// topics to publish and any posts due a refresh. Nothing auto-publishes — the
// email points at the queue and a human decides.
//
// Server-only. Runs from the daily cron; sends only on Monday (Asia/Karachi),
// and only once per day, guarded by an app_settings timestamp so a re-run of
// the idempotent cron does not send twice.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { listSuggestions, postsDueForRefresh } from './feed'

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

  const [{ content }, refresh] = await Promise.all([listSuggestions(), postsDueForRefresh(5)])
  const top = content.slice(0, 3).map((s) => ({
    title: s.title,
    why: `priority ${s.priority} — ${s.evidence[0] ?? ''}`.trim(),
    href: '/admin/blog/queue',
  }))
  const refreshItems = refresh.map((r) => ({ title: r.title, href: `/admin/blog/${r.id}` }))

  // Owner and manager only.
  const { data: staff } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .in('admin_role', ['owner', 'manager'])
    .limit(50)

  let recipients = 0
  for (const s of staff ?? []) {
    const r = await deliverEmail(
      { userId: s.id as string },
      { id: 'content_digest', suggestions: top, refresh: refreshItems },
    )
    if (r.ok) recipients++
  }

  // Stamp the marker even if a send failed: the point is not to retry-storm a
  // broken mailer at every cron tick. A missed digest is a smaller problem than
  // a daily one.
  await admin.from('app_settings').upsert({ key: LAST_SENT_KEY, value: date }, { onConflict: 'key' })

  return { sent: true, recipients }
}
