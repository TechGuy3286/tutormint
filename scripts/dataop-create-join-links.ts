/**
 * scripts/dataop-create-join-links.ts — creates the personal join link and code
 * of every participating staff member (Tuitions staff, Operations, Admin) that
 * does not have one yet (owner, 15 Oct 2026). The same rule as
 * lib/staffSignups ensureJoinLinks (which the board also runs); never changes
 * or removes an existing link. Read-only without --apply.
 *   npx tsx --env-file=.env.local scripts/dataop-create-join-links.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { codeForSlug, isParticipantRole, pickSlug } from '../lib/staffSignupsCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const staff = (
      await c.query(`select id, full_name, admin_role from profiles where role = 'admin' and admin_role is not null order by created_at`)
    ).rows as { id: string; full_name: string | null; admin_role: string }[]
    const existing = (await c.query(`select staff_id, slug, code from staff_join_links`)).rows as { staff_id: string; slug: string; code: string }[]
    const have = new Set(existing.map((r) => r.staff_id))
    const slugs = new Set(existing.map((r) => r.slug))
    const codes = new Set(existing.map((r) => r.code))
    await c.query('begin')
    for (const s of staff) {
      if (have.has(s.id) || !isParticipantRole(s.admin_role)) continue
      let slug = pickSlug(s.full_name, slugs)
      while (codes.has(codeForSlug(slug))) slug = pickSlug(`${slug}x`, slugs)
      const code = codeForSlug(slug)
      await c.query(`insert into staff_join_links (staff_id, slug, code) values ($1, $2, $3)`, [s.id, slug, code])
      slugs.add(slug)
      codes.add(code)
      console.log(`new: ${s.full_name} (${s.admin_role}) → /join/${slug} · ${code}`)
    }
    await c.query(apply ? 'commit' : 'rollback')
    const all = (
      await c.query(`select p.full_name, p.admin_role, l.slug, l.code from staff_join_links l join profiles p on p.id = l.staff_id order by p.admin_role, p.full_name`)
    ).rows
    for (const r of all) console.log(`${r.full_name} (${r.admin_role}): https://www.tutormint.org/join/${r.slug} · ${r.code}`)
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
