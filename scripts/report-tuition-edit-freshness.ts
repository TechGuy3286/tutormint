// scripts/report-tuition-edit-freshness.ts — READ ONLY (hotfix, 1 Nov 2026).
//
// Does a tuition's cached page show an edit within 10 minutes? Lists every
// tuition edited (staff: admin_audit_log job.edit; parent: user_activity_log
// job_edited) since --since, and checks that its live page now shows the stored
// title. Changes nothing; prints TM numbers, times and page status only.
//
//   npx tsx --env-file=.env.local scripts/report-tuition-edit-freshness.ts --since=2026-11-01T14:54:00Z
import { createClient } from '@supabase/supabase-js'
import { tuitionPath } from '../lib/slugs'

const SITE = 'https://www.tutormint.org'
const since = process.argv.find((a) => a.startsWith('--since='))?.slice(8) ?? new Date(Date.now() - 3600_000).toISOString()

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const [{ data: staff }, { data: member }] = await Promise.all([
    db.from('admin_audit_log').select('target_id, created_at').eq('action', 'job.edit').gte('created_at', since),
    db.from('user_activity_log').select('target_id, created_at').eq('event_type', 'job_edited').gte('created_at', since),
  ])
  const lastEdit = new Map<string, string>()
  for (const r of [...(staff ?? []), ...(member ?? [])]) {
    const id = r.target_id as string | null
    if (!id) continue
    if (!lastEdit.has(id) || (lastEdit.get(id) as string) < (r.created_at as string)) lastEdit.set(id, r.created_at as string)
  }
  // New posts use the same rebuild-on-change path: each must be on its city page.
  const { data: posts } = await db.from('jobs').select('ref_id, city, public_slug, status, created_at').gte('created_at', since).eq('status', 'open')
  console.log(`open tuitions posted since ${since}: ${(posts ?? []).length}`)
  const hubs = new Map<string, string>()
  for (const p of posts ?? []) {
    const hub = `/tuition-jobs/${p.city ? String(p.city).toLowerCase().trim().replace(/\s+/g, '-') : ''}`
    if (!hubs.has(hub)) {
      const r = await fetch(SITE + hub, { headers: { 'user-agent': 'TutorMint-link-check' } })
      hubs.set(hub, r.status === 200 ? await r.text() : '')
    }
    const mins = ((Date.now() - Date.parse(p.created_at as string)) / 60_000).toFixed(1)
    const onHub = (hubs.get(hub) ?? '').includes(String(p.public_slug))
    console.log(`  ${p.ref_id} posted ${mins} min ago | on ${hub}: ${hubs.get(hub) ? (onHub ? 'yes' : 'NO') : 'no hub page'}`)
  }
  console.log(`edits since ${since}: ${lastEdit.size}`)
  if (lastEdit.size === 0) return
  const { data: jobs } = await db.from('jobs').select('id, ref_id, title, city, public_slug, status').in('id', [...lastEdit.keys()])
  for (const j of jobs ?? []) {
    const path = tuitionPath(j as never)
    const editedAt = lastEdit.get(j.id as string) as string
    const mins = ((Date.now() - Date.parse(editedAt)) / 60_000).toFixed(1)
    const res = await fetch(SITE + path, { headers: { 'user-agent': 'TutorMint-link-check' } })
    const html = await res.text()
    const shows = html.includes(esc(String(j.title ?? '').trim()))
    console.log(`${j.ref_id} | ${j.status} | edited ${editedAt} (${mins} min ago) | page ${res.status} cache=${res.headers.get('x-vercel-cache')} age=${res.headers.get('age') ?? '-'} | shows the edited title: ${shows ? 'yes' : 'NO'}`)
  }
}

main()
