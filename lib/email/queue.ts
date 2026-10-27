import 'server-only'

// lib/email/queue.ts — sends the emails held back (owner, 27 Oct 2026), run by
// the daily cron:
//   • 'daily_limit' — held because the day had reached 90% of the limit; sent
//     now, oldest first, up to the day's room;
//   • 'summary'     — non-urgent member emails; one combined summary per person.
// What is sent (or dropped by the rules) is stamped and its body cleared. Rules
// in lib/email/policyCore.ts. Never logs an address.

import { createAdminClient } from '@/lib/supabase/admin'
import { render } from '@/lib/notify/templates'
import { sendBulk, sendOne } from './send'
import { loadFacts } from './policy'
import { groupSummaries, roomToday, type HeldRow } from './policyCore'

export type DrainSummary = { limitSent: number; limitWaiting: number; summariesSent: number; summaryItems: number; dropped: number }

const CLEARED = { subject: null, body_text: null, body_html: null }

export async function drainEmailQueue(now = new Date()): Promise<DrainSummary> {
  const out: DrainSummary = { limitSent: 0, limitWaiting: 0, summariesSent: 0, summaryItems: 0, dropped: 0 }
  const admin = createAdminClient()
  if (!admin) return out
  const facts = await loadFacts([{ to: 'room@check.invalid', template: 'room' }], now)
  let room = roomToday(facts.sentToday, facts.limit)

  // 1. Emails held by the daily limit.
  const { data: held } = await admin
    .from('email_queue')
    .select('id, template, recipient, subject, body_text, body_html')
    .eq('kind', 'daily_limit')
    .is('sent_at', null)
    .is('dropped_at', null)
    .lte('due_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(500)
  for (const h of held ?? []) {
    if (room <= 0) {
      out.limitWaiting++
      continue
    }
    const r = await sendOne(
      { to: h.recipient as string, subject: (h.subject as string) ?? 'TutorMint', text: (h.body_text as string) ?? '', html: (h.body_html as string | null) ?? undefined, template: (h.template as string | null) ?? undefined },
      { job: `queued:${h.template ?? 'email'}`, fromQueue: true },
    )
    const stamp = r.ok ? { sent_at: now.toISOString(), ...CLEARED } : { dropped_at: now.toISOString(), drop_reason: r.reason.slice(0, 200), ...CLEARED }
    await admin.from('email_queue').update(stamp).eq('id', h.id)
    if (r.ok) {
      out.limitSent++
      room--
    } else out.dropped++
  }

  // 2. The daily summaries.
  if (room > 0) {
    const { data: rows } = await admin
      .from('email_queue')
      .select('id, template, recipient, subject, body_text, created_at')
      .eq('kind', 'summary')
      .is('sent_at', null)
      .is('dropped_at', null)
      .order('created_at', { ascending: true })
      .limit(1000)
    const groups = groupSummaries(
      (rows ?? []).map((r) => ({
        id: r.id as string,
        recipient: r.recipient as string,
        template: (r.template as string | null) ?? null,
        subject: (r.subject as string | null) ?? null,
        text: (r.body_text as string | null) ?? null,
        createdAt: r.created_at as string,
      })) satisfies HeldRow[],
    ).slice(0, room)
    if (groups.length > 0) {
      const messages = groups.map((g) => {
        const m = render({ id: 'daily_summary', items: g.items })
        return { to: g.recipient, subject: m.subject, text: m.text, html: m.html, template: 'daily_summary' }
      })
      const { results } = await sendBulk(messages, { job: 'daily_summary', fromQueue: true })
      for (let i = 0; i < groups.length; i++) {
        const r = results[i]
        const stamp = r.ok ? { sent_at: now.toISOString(), ...CLEARED } : { dropped_at: now.toISOString(), drop_reason: r.reason.slice(0, 200), ...CLEARED }
        await admin.from('email_queue').update(stamp).in('id', groups[i].ids)
        if (r.ok) {
          out.summariesSent++
          out.summaryItems += groups[i].items.length
        } else out.dropped += groups[i].ids.length
      }
    }
  }
  console.info(`[email-queue] held sent ${out.limitSent}, still waiting ${out.limitWaiting}, summaries ${out.summariesSent} (${out.summaryItems} items), dropped ${out.dropped}`)
  return out
}
