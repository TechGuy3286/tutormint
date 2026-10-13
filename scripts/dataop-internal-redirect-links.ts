/**
 * scripts/dataop-internal-redirect-links.ts  (owner, 13 Oct 2026)
 *
 * Internal links that pointed at an address which only redirects:
 *   - blog posts (published and draft) linking /apply (a 307 to /register, kept
 *     for social posts) now link /register directly. Only the link TARGET
 *     changes — no word, heading, slug, title, publish date or approval. Each
 *     changed post gets a post_revisions row and an admin_audit_log row, as the
 *     owner (the same record the fee rename wrote).
 *   - notifications whose link is /account/messages (a redirect) now link the
 *     member's own Team conversation: /tutor/… or /parent/dashboard/messages/team.
 *     Only the href changes; the title, body, read state and date do not.
 *
 * NOT touched: post_revisions, the audit log, member timelines.
 * Safe to run twice: the second run finds nothing to change.
 *   npx tsx --env-file=.env.local scripts/dataop-internal-redirect-links.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/dataop-internal-redirect-links.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

// "](/apply)", "](/apply?utm=x)", "](https://www.tutormint.org/apply)" — the path only.
const APPLY = /(\]\((?:https?:\/\/(?:www\.)?tutormint\.org)?)\/apply(?=[)?#\s])/gi
const swap = (s: string | null) => (s == null ? s : s.replace(APPLY, '$1/register'))
const hits = (s: string | null) => (s == null ? 0 : (s.match(APPLY) ?? []).length)

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const owner = (await c.query("select id, email from profiles where admin_role = 'owner' limit 1")).rows[0]
  if (!owner) throw new Error('no owner account')

  const { rows: posts } = await c.query('select * from posts order by created_at')
  const plan = posts.map((row: Record<string, string | null>) => ({ row, n: hits(row.body) })).filter((p: { n: number }) => p.n > 0)
  for (const p of plan) console.log(`post: ${p.row.slug} (${p.row.status}) · ${p.n} link(s) /apply -> /register`)
  const links = plan.reduce((n: number, p: { n: number }) => n + p.n, 0)

  const { rows: notif } = await c.query(
    `select case when p.role = 'tutor' then 'tutor' else 'parent' end as role, count(*)::int as n
       from notifications n join profiles p on p.id = n.user_id
      where n.href = '/account/messages' group by 1 order by 1`,
  )
  const notifTotal = notif.reduce((n: number, r: { n: number }) => n + r.n, 0)
  for (const r of notif) console.log(`notifications linking /account/messages (${r.role}): ${r.n}`)
  console.log(`posts to change: ${plan.length} (${links} links) · notification links to change: ${notifTotal}`)

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.')
    await c.end()
    return
  }

  await c.query('begin')
  try {
    for (const { row, n } of plan) {
      const body = swap(row.body)
      await c.query('update posts set body = $1, updated_at = now() where id = $2', [body, row.id])
      await c.query(
        `insert into post_revisions (post_id, title, slug, cluster, audience, language, body, cover_path, cover_alt, seo_title, seo_description, related_landing_pages, source_notes, status, editor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [row.id, row.title, row.slug, row.cluster, row.audience, row.language, body, row.cover_path, row.cover_alt, row.seo_title, row.seo_description, row.related_landing_pages, row.source_notes, row.status, owner.id],
      )
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1,$2,'owner','blog.fix_redirect_links','post',$3,$4)`,
        [owner.id, owner.email, row.id, JSON.stringify({ slug: row.slug, links: n, from: '/apply', to: '/register', reason: 'internal links point straight at the final page (owner, 13 Oct 2026)', script: 'scripts/dataop-internal-redirect-links.ts' })],
      )
    }
    const upd = await c.query(
      `update notifications n
          set href = case when p.role = 'tutor' then '/tutor/dashboard/messages/team' else '/parent/dashboard/messages/team' end
         from profiles p
        where p.id = n.user_id and n.href = '/account/messages'`,
    )
    if (notifTotal > 0) {
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1,$2,'owner','notifications.fix_redirect_links','notification',null,$3)`,
        [owner.id, owner.email, JSON.stringify({ rows: upd.rowCount, from: '/account/messages', to: '/{role}/dashboard/messages/team', script: 'scripts/dataop-internal-redirect-links.ts' })],
      )
    }
    await c.query('commit')
    console.log(`Applied: ${plan.length} posts (${links} links), ${upd.rowCount} notification links.`)
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
