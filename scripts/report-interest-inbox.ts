/**
 * scripts/report-interest-inbox.ts — PR-10: the Parent interest inbox in
 * numbers, read-only, production. COUNTS ONLY — no name, phone or email; staff
 * are shown by role and how many cities they own.
 *   npm run report:interestinbox
 */
import { loadInterestInboxFresh } from '../lib/interestInbox'
import { createAdminClient } from '../lib/supabase/admin'
import { INBOX_KINDS } from '../lib/interestInboxCore'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('service role unavailable')
  const t0 = Date.now()
  const inbox = await loadInterestInboxFresh()
  const c = inbox.counts
  console.log(`rows ${inbox.rows.length} (one per tutor) — loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const parentsBy: Record<string, Set<string>> = {}
  for (const r of inbox.rows) for (const p of r.parents) for (const a of p.actions) (parentsBy[a.kind] ??= new Set()).add(p.parentId)
  console.log(`distinct parents behind the rows: ${INBOX_KINDS.map((k) => `${k} ${parentsBy[k]?.size ?? 0}`).join(' · ')}`)
  console.log(`by tab: to send ${c.byTab.to_send} · sent ${c.byTab.sent} · new activity since sent ${c.byTab.new_since_sent}`)
  for (const t of ['to_send', 'sent', 'new_since_sent'] as const) {
    console.log(`  ${t} rows carrying: ${INBOX_KINDS.map((k) => `${k} ${c.byTabKind[t][k]}`).join(' · ')}`)
  }
  const hottest: Record<string, number> = {}
  for (const r of inbox.rows) hottest[r.summary.hottest] = (hottest[r.summary.hottest] ?? 0) + 1
  console.log(`by hottest activity: ${INBOX_KINDS.map((k) => `${k} ${hottest[k] ?? 0}`).join(' · ')}`)
  console.log(`ready today ${c.ready} (${c.readyDemo} with a demo request) · waiting beyond cap ${c.waitingBeyondCap} (sent today ${c.waitingByReason.sent_today}, week cap ${c.waitingByReason.week_cap}, unpaid daily cap ${c.waitingByReason.daily_cap}) · unpaid sent today ${c.unpaidSentToday}`)
  console.log(`paid rows ${inbox.rows.filter((r) => r.paid).length} · unpaid rows ${inbox.rows.filter((r) => !r.paid).length}`)
  console.log(`left out: not eligible ${inbox.excluded.notEligible} · opted out ${inbox.excluded.optedOut} · no number ${inbox.excluded.noNumber}`)

  const ids = [...new Set(inbox.rows.map((r) => r.assigneeId))]
  const { data: roles } = ids.length ? await admin.from('profiles').select('id, admin_role').in('id', ids) : { data: [] }
  const roleBy = new Map((roles ?? []).map((p) => [p.id as string, (p.admin_role as string | null) ?? 'none']))
  const { data: owners } = await admin.from('city_owners').select('city, staff_id')
  const citiesBy = new Map<string, number>()
  for (const o of owners ?? []) if (o.staff_id) citiesBy.set(o.staff_id as string, (citiesBy.get(o.staff_id as string) ?? 0) + 1)
  ids.forEach((id, i) => {
    const rows = inbox.rows.filter((r) => r.assigneeId === id)
    const role = roleBy.get(id) ?? 'unknown'
    const label = role === 'owner' ? 'Owner (cities with no city owner)' : `city owner ${String.fromCharCode(65 + i)} (${role}, ${citiesBy.get(id) ?? 0} cities)`
    console.log(`  ${label}: ${rows.length} rows · ready ${c.readyByAssignee[id] ?? 0}`)
  })
}

main().catch((e) => {
  console.error('report failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
  process.exitCode = 1
})
