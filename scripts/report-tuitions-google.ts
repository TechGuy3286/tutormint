/**
 * scripts/report-tuitions-google.ts — READ-ONLY.
 *
 * Part A of the "tuitions on Google" PR (owner, 16 Oct 2026): the Indexing API
 * queue over the last 14 days (sent / failed / superseded / waiting per UTC day
 * and kind, the errors Google gave), and whether every tuition posted in that
 * time was ever queued. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-tuitions-google.ts [days]
 */
import { createClient } from '@supabase/supabase-js'
import { citySegment } from '../lib/slugs'

const SITE = 'https://www.tutormint.org'
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
  const days = Number(process.argv[2] ?? 14)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  type Q = { id: number; url: string; kind: string; created_at: string; sent_at: string | null; last_error: string | null }
  const rows = await all<Q>((f, t) =>
    admin.from('indexing_queue').select('id, url, kind, created_at, sent_at, last_error').gte('created_at', since).order('id').range(f, t),
  )
  const everQueued = new Set(
    (await all<{ url: string }>((f, t) => admin.from('indexing_queue').select('url').order('id').range(f, t))).map((r) => r.url),
  )
  const firstRow = await admin.from('indexing_queue').select('created_at').order('id').limit(1)
  console.log(`indexing_queue: ${rows.length} rows created in the last ${days} days; first row ever ${firstRow.data?.[0]?.created_at ?? 'none'}`)

  const byDay = new Map<string, Record<string, number>>()
  const bump = (d: string, k: string) => {
    const o = byDay.get(d) ?? {}
    o[k] = (o[k] ?? 0) + 1
    byDay.set(d, o)
  }
  const errors = new Map<string, number>()
  for (const r of rows) {
    const superseded = r.last_error === 'superseded'
    if (superseded) {
      bump(r.created_at.slice(0, 10), 'superseded')
      continue
    }
    if (!r.sent_at) {
      bump(r.created_at.slice(0, 10), `waiting_${r.kind}`)
      if (r.last_error) errors.set(r.last_error.slice(0, 140), (errors.get(r.last_error.slice(0, 140)) ?? 0) + 1)
      continue
    }
    const d = r.sent_at.slice(0, 10)
    if (r.last_error) {
      bump(d, `failed_${r.kind}`)
      errors.set(r.last_error.slice(0, 140), (errors.get(r.last_error.slice(0, 140)) ?? 0) + 1)
    } else bump(d, `ok_${r.kind}`)
  }
  console.log('\nPer UTC day (sent day for sent rows, created day otherwise):')
  for (const [d, o] of [...byDay.entries()].sort()) {
    const sent = (o.ok_URL_UPDATED ?? 0) + (o.ok_URL_DELETED ?? 0) + (o.failed_URL_UPDATED ?? 0) + (o.failed_URL_DELETED ?? 0)
    console.log(d, JSON.stringify(o), `| attempted ${sent}/200`)
  }
  console.log('\nErrors (text → count):')
  for (const [e, n] of [...errors.entries()].sort((a, b) => b[1] - a[1])) console.log(n, e)

  // Tuitions posted in the window: was each queued at all?
  type J = { id: string; ref_id: string | null; public_slug: string | null; city: string | null; status: string; created_at: string; title: string | null }
  const jobs = await all<J>((f, t) =>
    admin.from('jobs').select('id, ref_id, public_slug, city, status, created_at, title').gte('created_at', since).order('created_at').range(f, t),
  )
  const indexable = new Set(
    (await all<{ public_slug: string }>((f, t) => admin.rpc('indexable_job_slugs').order('public_slug').range(f, t))).map((r) => r.public_slug),
  )
  const missed: J[] = []
  for (const j of jobs) {
    if (!j.public_slug) continue
    const url = `${SITE}/tuitions/${citySegment(j.city)}/${j.public_slug}`
    if (!everQueued.has(url)) missed.push(j)
  }
  console.log(`\nTuitions posted in the last ${days} days: ${jobs.length}; never queued: ${missed.length} (of which indexable now: ${missed.filter((m) => indexable.has(m.public_slug!)).length})`)
  for (const m of missed.slice(0, 60)) console.log(' ', pk(m.created_at), m.ref_id, m.status, `/tuitions/${citySegment(m.city)}/${m.public_slug}`)

  const fsd = 'female-home-tutor-required-grade-9-10-arts-grade-9-10-science-home-tut-e98c25'
  const { data: f } = await admin.from('jobs').select('id, ref_id, status, created_at, city, public_slug').eq('public_slug', fsd).maybeSingle()
  const furl = `${SITE}/tuitions/faisalabad/${fsd}`
  const fq = rows.filter((r) => r.url === furl)
  console.log('\nFaisalabad tuition:', JSON.stringify(f), 'queue rows:', JSON.stringify(fq))

  // Pause counts by source.
  const paused = await all<{ pause_source: string | null; paused_at: string | null }>((f2, t) =>
    admin.from('jobs').select('pause_source, paused_at').eq('status', 'paused').order('id').range(f2, t),
  )
  const bySrc: Record<string, number> = {}
  for (const p of paused) bySrc[p.pause_source ?? 'null'] = (bySrc[p.pause_source ?? 'null'] ?? 0) + 1
  const within60 = paused.filter((p) => p.paused_at && Date.now() - Date.parse(p.paused_at) < 60 * 86_400_000).length
  console.log(`\nPaused tuitions: ${paused.length} by source ${JSON.stringify(bySrc)}; paused within the last 60 days: ${within60}`)
  const { data: sample } = await admin.from('jobs').select('public_slug, city, pause_source, paused_at').eq('status', 'paused').order('paused_at', { ascending: false }).limit(2)
  for (const s of sample ?? []) console.log('paused sample:', `${SITE}/tuitions/${citySegment(s.city)}/${s.public_slug}`, s.pause_source, s.paused_at)
  const { count: openCount } = await admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open')
  console.log(`Open tuitions: ${openCount}; indexable (indexable_job_slugs): ${indexable.size}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
