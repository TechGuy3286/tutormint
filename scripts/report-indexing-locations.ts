/**
 * scripts/report-indexing-locations.ts — READ-ONLY (owner, 16 Oct 2026).
 *
 * 1. indexing_queue: rows that are NOT a single tuition page (/tuitions/<city>/<slug>),
 *    when they were queued, how many waiting / sent; tuition rows whose address is
 *    not the tuition's current address (an old city segment).
 * 2. indexing_attempts today (Pacific day): ok / failed / quota refusals.
 * 3. admin_audit_log location.* rows on 16 Oct (Pakistan time), grouped by minute and actor.
 * 4. Paused tuitions: how many were paused more than 60 days ago.
 *   npx tsx --env-file=.env.local scripts/report-indexing-locations.ts
 */
import { createClient } from '@supabase/supabase-js'
import { citySegment } from '../lib/slugs'
import { pacificDayStart } from '../lib/googleIndexingCore'

const pk = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '—')

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  type Q = { id: number; url: string; kind: string; created_at: string; sent_at: string | null; last_error: string | null; priority: number }
  const since = '2026-10-14T00:00:00Z'
  const q = await all<Q>((f, t) => db.from('indexing_queue').select('id, url, kind, created_at, sent_at, last_error, priority').gte('created_at', since).order('id').range(f, t))
  const isTuition = (u: string) => /^https:\/\/www\.tutormint\.org\/tuitions\/[^/]+\/[^/?#]+-[0-9a-f]{4,}$/.test(u)
  const other = q.filter((r) => !isTuition(r.url))
  console.log(`queue rows since 14 Oct: ${q.length}; NOT a tuition page: ${other.length}`)
  const byMin = new Map<string, number>()
  for (const r of other) byMin.set(pk(r.created_at), (byMin.get(pk(r.created_at)) ?? 0) + 1)
  console.log('non-tuition rows by minute (PKT):', JSON.stringify([...byMin.entries()]))
  const waitingOther = other.filter((r) => !r.sent_at)
  const sentOther = other.filter((r) => r.sent_at && r.sent_at > '1971')
  console.log(`  waiting: ${waitingOther.length}; sent: ${sentOther.length}; distinct urls: ${new Set(other.map((r) => r.url)).size}`)
  for (const r of other.slice(0, 6)) console.log('  e.g.', r.id, pk(r.created_at), r.url, r.sent_at ? 'sent' : 'waiting', r.last_error ?? '')

  // Old addresses: tuition URL whose city segment is not the tuition's current one.
  const tuitionRows = q.filter((r) => isTuition(r.url))
  const slugs = [...new Set(tuitionRows.map((r) => r.url.split('/').pop()!))]
  const jobs: { public_slug: string; city: string | null; status: string; merged_into: string | null }[] = []
  for (let i = 0; i < slugs.length; i += 200) {
    const { data } = await db.from('jobs').select('public_slug, city, status, merged_into').in('public_slug', slugs.slice(i, i + 200))
    jobs.push(...((data ?? []) as typeof jobs))
  }
  const bySlug = new Map(jobs.map((j) => [j.public_slug, j]))
  const old = tuitionRows.filter((r) => {
    const [, , , , city, slug] = r.url.split('/')
    const j = bySlug.get(slug)
    return !j || citySegment(j.city) !== city || !!j.merged_into
  })
  console.log(`tuition rows whose address is not current (old city segment / merged / missing): ${old.length} (waiting ${old.filter((r) => !r.sent_at).length})`)
  for (const r of old.slice(0, 8)) console.log('  ', r.id, pk(r.created_at), r.url, r.sent_at ? `sent ${pk(r.sent_at)}` : 'waiting', r.last_error ?? '')
  const { count: waitingAll } = await db.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null)
  console.log(`waiting now (all): ${waitingAll}`)

  // Attempts today (Pacific).
  const day = pacificDayStart(new Date()).toISOString()
  const at = await all<{ attempted_at: string; ok: boolean; error: string | null; url: string }>((f, t) =>
    db.from('indexing_attempts').select('attempted_at, ok, error, url').gte('attempted_at', day).order('id').range(f, t),
  )
  const quota = at.filter((a) => !a.ok && /quota/i.test(a.error ?? ''))
  console.log(`attempts since Pacific midnight (${day}): ${at.length}; ok ${at.filter((a) => a.ok).length}; quota refusals ${quota.length}; other failures ${at.filter((a) => !a.ok && !/quota/i.test(a.error ?? '')).length}`)
  console.log(`  of which non-tuition urls: ${at.filter((a) => !isTuition(a.url)).length}`)

  // Locations audit on 16 Oct PKT.
  const audit = await all<{ action: string; actor_email: string | null; created_at: string; detail: Record<string, unknown> | null; target_id: string | null }>((f, t) =>
    db
      .from('admin_audit_log')
      .select('action, actor_email, created_at, detail, target_id')
      .like('action', 'location.%')
      .gte('created_at', '2026-10-15T19:00:00Z')
      .order('created_at')
      .range(f, t),
  )
  const groups = new Map<string, number>()
  for (const a of audit) {
    const k = `${pk(a.created_at)} ${a.actor_email} ${a.action}`
    groups.set(k, (groups.get(k) ?? 0) + 1)
  }
  console.log(`location.* audit rows since 16 Oct 00:00 PKT: ${audit.length}`)
  for (const [k, n] of groups) console.log('  ', n, k)
  for (const a of audit.slice(0, 10)) console.log('   detail', pk(a.created_at), a.action, JSON.stringify(a.detail).slice(0, 160))

  const { count: aliases } = await db.from('location_area_aliases').select('id', { count: 'exact', head: true }).gte('created_at', '2026-10-15T19:00:00Z')
  const { count: ignored } = await db.from('location_ignored').select('id', { count: 'exact', head: true }).gte('created_at', '2026-10-15T19:00:00Z')
  const { count: areasAdded } = await db.from('location_areas').select('id', { count: 'exact', head: true }).gte('created_at', '2026-10-15T19:00:00Z')
  console.log(`rows created 16 Oct PKT: aliases ${aliases}, not-an-area ${ignored}, curated areas ${areasAdded}`)

  // Paused > 60 days.
  const paused = await all<{ paused_at: string | null }>((f, t) => db.from('jobs').select('paused_at').eq('status', 'paused').order('id').range(f, t))
  const cutoff = Date.now() - 60 * 86_400_000
  console.log(`paused: ${paused.length}; paused_at null: ${paused.filter((p) => !p.paused_at).length}; older than 60 days: ${paused.filter((p) => p.paused_at && Date.parse(p.paused_at) < cutoff).length}; oldest ${paused.map((p) => p.paused_at).filter(Boolean).sort()[0]}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
