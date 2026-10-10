/**
 * scripts/dataop-rename-fee.ts  (owner, 10 Oct 2026)
 *
 * The tutor fee is renamed "Verification Fee". This swaps the old NAME — the
 * exact words "Spam Free Platform Fee" (any case, with or without the hyphen) —
 * for "Verification Fee" in the stored text a member can read:
 *   - blog posts (body, SEO title, SEO description), published and draft;
 *   - message templates (title, subject, body), only where they hold the name.
 * Nothing else in a post changes: no other word, no link, no heading, no slug,
 * title, publish date or approval. Each changed post gets a post_revisions row
 * (the record an editor save writes) and an admin_audit_log row, as the owner.
 *
 * NOT touched: notifications already sent, post_revisions, the audit log and
 * member timelines — they are records of what was said at the time.
 *
 * Safe to run twice: the second run finds nothing to change.
 *   npx tsx --env-file=.env.local scripts/dataop-rename-fee.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/dataop-rename-fee.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const OLD = /spam[\s-]+free\s+platform\s+fee/gi
const NEW = 'Verification Fee'
const swap = (s: string | null) => (s == null ? s : s.replace(OLD, NEW))
const hits = (s: string | null) => (s == null ? 0 : (s.match(OLD) ?? []).length)

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const owner = (await c.query("select id, email from profiles where admin_role = 'owner' limit 1")).rows[0]
  if (!owner) throw new Error('no owner account')

  const { rows: posts } = await c.query('select * from posts order by created_at')
  const postPlan = posts
    .map((row: Record<string, string | null>) => ({ row, n: hits(row.body) + hits(row.seo_title) + hits(row.seo_description) }))
    .filter((p: { n: number }) => p.n > 0)
  for (const p of postPlan) console.log(`post: ${p.row.slug} (${p.row.status}) · ${p.n} occurrence(s)`)

  const { rows: templates } = await c.query('select key, title, subject, body from admin_message_templates')
  const tplPlan = templates.filter((t: Record<string, string | null>) => hits(t.title) + hits(t.subject) + hits(t.body) > 0)
  for (const t of tplPlan) console.log(`template: ${t.key}`)
  console.log(`posts to change: ${postPlan.length} · templates to change: ${tplPlan.length}`)

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.')
    await c.end()
    return
  }

  await c.query('begin')
  try {
    for (const { row, n } of postPlan) {
      const body = swap(row.body)
      const seoTitle = swap(row.seo_title)
      const seoDescription = swap(row.seo_description)
      await c.query('update posts set body = $1, seo_title = $2, seo_description = $3, updated_at = now() where id = $4', [body, seoTitle, seoDescription, row.id])
      await c.query(
        `insert into post_revisions (post_id, title, slug, cluster, audience, language, body, cover_path, cover_alt, seo_title, seo_description, related_landing_pages, source_notes, status, editor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [row.id, row.title, row.slug, row.cluster, row.audience, row.language, body, row.cover_path, row.cover_alt, seoTitle, seoDescription, row.related_landing_pages, row.source_notes, row.status, owner.id],
      )
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1,$2,'owner','blog.rename_fee','post',$3,$4)`,
        [owner.id, owner.email, row.id, JSON.stringify({ slug: row.slug, occurrences: n, reason: 'fee renamed to Verification Fee (owner, 10 Oct 2026)', script: 'scripts/dataop-rename-fee.ts' })],
      )
    }
    for (const t of tplPlan) {
      await c.query('update admin_message_templates set title = $1, subject = $2, body = $3 where key = $4', [swap(t.title), swap(t.subject), swap(t.body), t.key])
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1,$2,'owner','template.rename_fee','message_template',$3,$4)`,
        [owner.id, owner.email, t.key, JSON.stringify({ reason: 'fee renamed to Verification Fee (owner, 10 Oct 2026)' })],
      )
    }
    await c.query('commit')
    console.log(`Applied: ${postPlan.length} posts, ${tplPlan.length} templates.`)
  } catch (e) {
    await c.query('rollback')
    throw e
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
