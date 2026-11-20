/**
 * scripts/dataop-pr12-wording.ts — PR-12 Part D (owner, 20 Nov 2026): remove the
 * "middleman / no commission / no agent" wording from stored content in
 * production: 4 published blog posts (body / seo_description only — slugs and
 * URLs unchanged), 2 WhatsApp templates (admin_message_templates) and 1 content
 * queue suggestion. Content only, never test data. Nothing is deleted: each
 * post gets a post_revisions row of its new state (as an admin save does), each
 * template's old wording goes to template_history first.
 *
 * One transaction; without --apply it ROLLS BACK (dry run). Asserts every
 * expected phrase was found and that no matching phrase remains. Prints only
 * the changed sentences — never a name, phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/dataop-pr12-wording.ts [--apply]
 */
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const SQL_PAT = String.raw`middle ?m[ae]n|no commission|no agent|without (an )?agent|agent[- ]free|koi agent|commission nahi|ایجنٹ|کمیشن|مڈل ?مین`

type Edit = { table: 'posts' | 'admin_message_templates' | 'content_suggestions'; key: string; col: string; from: string; to: string }

const EDITS: Edit[] = [
  { table: 'posts', key: '34e7ba28-6579-4d00-a768-2de014e208c9', col: 'body', from: ' TutorMint takes no commission on any tuition.', to: '' },
  { table: 'posts', key: '0c8993f9-fba0-4310-9c79-0b435894179e', col: 'body', from: ' TutorMint takes no commission on any tuition.', to: '' },
  { table: 'posts', key: '371b1cb4-aa03-4466-a7b4-43b1651600eb', col: 'seo_description', from: 'Free to join. No commission. No middleman.', to: 'Free to join.' },
  { table: 'posts', key: '0449e915-ce70-4789-bab2-ea0940a9b8e1', col: 'body', from: '**Talk to parents directly.** There is no agent and no commission. You agree', to: '**Talk to parents directly.** You agree' },
  { table: 'posts', key: '0449e915-ce70-4789-bab2-ea0940a9b8e1', col: 'body', from: '- **Free to join. No commission. No middleman.**', to: '- **Free to join.**' },
  { table: 'admin_message_templates', key: 'city_hiring_post', col: 'body', from: 'find home and online tuitions near you. No commission, no middleman. Join:', to: 'find home and online tuitions near you. Join:' },
  { table: 'admin_message_templates', key: 'fu_fee_reply', col: 'body', from: 'Joining TutorMint is free — no commission, no middleman. To apply', to: 'Joining TutorMint is free. To apply' },
  { table: 'content_suggestions', key: 'bb922e0c-e697-42d9-b19c-68e4a82cbddc', col: 'notes', from: 'and that TutorMint takes no commission and never handles the money between tutor and parent.', to: 'and that TutorMint never handles the money between tutor and parent.' },
]

const OWNER_ID = 'a26def75-21e4-48d2-8f6f-371e672ba13f'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const pk = (t: Edit['table']) => (t === 'admin_message_templates' ? 'key' : 'id')
    const slugsBefore = (await c.query(`select id, slug, status from posts order by id`)).rows.map((r: { id: string; slug: string; status: string }) => `${r.id}:${r.slug}:${r.status}`).join('|')
    const postCountBefore = Number((await c.query(`select count(*)::int n from posts`)).rows[0].n)
    const otherPostsSig = `select md5(string_agg(md5(to_jsonb(p)::text), '' order by id)) h from posts p where id <> all($1::uuid[])`
    const touchedPosts = [...new Set(EDITS.filter((e) => e.table === 'posts').map((e) => e.key))]
    const othersBefore = (await c.query(otherPostsSig, [touchedPosts])).rows[0].h

    // Template history first: the OLD wording of each template we change.
    for (const key of [...new Set(EDITS.filter((e) => e.table === 'admin_message_templates').map((e) => e.key))]) {
      const t = (await c.query(`select key, subject, body from admin_message_templates where key = $1`, [key])).rows[0]
      assert.ok(t, `template ${key} exists`)
      await c.query(
        `insert into template_history (key, kind, subject, body, action, saved_by, saved_by_name, saved_at) values ($1, 'whatsapp', $2, $3, 'approve', $4, 'PR-12 wording (owner-authorised)', now())`,
        [key, t.subject, t.body, OWNER_ID],
      )
    }

    for (const e of EDITS) {
      const row = (await c.query(`select ${e.col} as v from ${e.table} where ${pk(e.table)} = $1 for update`, [e.key])).rows[0]
      assert.ok(row, `${e.table} ${e.key} exists`)
      const v = String(row.v ?? '')
      assert.ok(v.includes(e.from), `${e.table} ${e.key} [${e.col}] still has: ${e.from}`)
      const next = v.split(e.from).join(e.to)
      const setUpdated = e.table === 'posts' || e.table === 'content_suggestions' ? ', updated_at = now()' : e.table === 'admin_message_templates' ? ', updated_at = now()' : ''
      await c.query(`update ${e.table} set ${e.col} = $2${setUpdated} where ${pk(e.table)} = $1`, [e.key, next])
      console.log(`${e.table} ${e.table === 'admin_message_templates' ? e.key : e.key.slice(0, 8)} [${e.col}]\n   - ${e.from}\n   + ${e.to || '(sentence removed)'}`)
    }

    // A revision per changed post, like an admin save (nothing silently lost).
    for (const id of touchedPosts) {
      await c.query(
        `insert into post_revisions (post_id, title, slug, cluster, audience, language, body, cover_path, cover_alt, seo_title, seo_description, related_landing_pages, source_notes, status, editor_id)
         select id, title, slug, cluster, audience, language, body, cover_path, cover_alt, seo_title, seo_description, related_landing_pages, source_notes, status, $2 from posts where id = $1`,
        [id, OWNER_ID],
      )
    }

    // Nothing matching is left in the live rows; slugs, statuses and other posts unchanged.
    for (const t of ['posts', 'admin_message_templates', 'content_suggestions']) {
      const left = Number((await c.query(`select count(*)::int n from ${t} x where x::text ~* $1`, [SQL_PAT])).rows[0].n)
      assert.equal(left, 0, `${t}: no matching wording left`)
    }
    assert.equal((await c.query(`select id, slug, status from posts order by id`)).rows.map((r: { id: string; slug: string; status: string }) => `${r.id}:${r.slug}:${r.status}`).join('|'), slugsBefore, 'slugs and statuses unchanged')
    assert.equal(Number((await c.query(`select count(*)::int n from posts`)).rows[0].n), postCountBefore, 'no post added or removed')
    assert.equal((await c.query(otherPostsSig, [touchedPosts])).rows[0].h, othersBefore, 'other posts untouched')

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
