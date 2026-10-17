/**
 * scripts/report-ai-signups.ts — read-only. How many accounts ever signed up
 * from an AI assistant (lib/signupSourceCore), per site and per role, and how
 * many of those are real (not seed / test / hidden / staff / team). Prints
 * counts only — no name, email or phone.
 *   npx tsx --env-file=.env.local scripts/report-ai-signups.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { aiAssistantSite } from '../lib/signupSourceCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(
      `select utm_source, role, created_at,
              (coalesce(is_seed,false) or coalesce(is_test_name,false) or coalesce(hidden_from_public,false)
               or coalesce(is_team_account,false) or admin_role is not null) as not_real
         from profiles where utm_source is not null and btrim(utm_source) <> ''`,
    )
    const bySite = new Map<string, { all: number; real: number; tutor: number; parent: number; first: string; last: string }>()
    for (const r of rows) {
      const site = aiAssistantSite(r.utm_source as string)
      if (!site) continue
      const e = bySite.get(site) ?? { all: 0, real: 0, tutor: 0, parent: 0, first: '9999', last: '0000' }
      e.all += 1
      if (!r.not_real) {
        e.real += 1
        if (r.role === 'tutor') e.tutor += 1
        else e.parent += 1
      }
      const d = new Date(r.created_at).toISOString().slice(0, 10)
      if (d < e.first) e.first = d
      if (d > e.last) e.last = d
      bySite.set(site, e)
    }
    const total = [...bySite.values()].reduce((n, e) => n + e.all, 0)
    const real = [...bySite.values()].reduce((n, e) => n + e.real, 0)
    console.log(`Accounts with any utm_source: ${rows.length}`)
    console.log(`From AI assistants: ${total} (real accounts: ${real})`)
    for (const [site, e] of [...bySite.entries()].sort((a, b) => b[1].all - a[1].all)) {
      console.log(`  ${site}: ${e.all} (real ${e.real}: ${e.tutor} tutor, ${e.parent} parent) · ${e.first} → ${e.last}`)
    }
    // Every distinct utm_source NOT grouped, so a missed AI site is visible.
    const other = new Map<string, number>()
    for (const r of rows) if (!aiAssistantSite(r.utm_source as string)) other.set(String(r.utm_source).toLowerCase(), (other.get(String(r.utm_source).toLowerCase()) ?? 0) + 1)
    console.log(`Other sources (not grouped): ${[...other.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
