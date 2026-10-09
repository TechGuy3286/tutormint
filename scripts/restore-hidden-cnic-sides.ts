/**
 * scripts/restore-hidden-cnic-sides.ts  (owner-approved, 9 Oct 2026)
 *
 * An earlier clean-up (scripts/dataop-pause-dup-documents.sql) kept only the
 * newest CNIC photo per MEMBER, not per side — so for most members the front
 * side was hidden (status 'paused') behind a newer back. For each member, for
 * each CNIC side (front, back) with NO visible upload, un-hide the newest
 * hidden upload of that side. Older duplicates stay hidden. Review statuses and
 * approval dates are not touched. One admin_audit_log row per restored file,
 * actor "system: restore CNIC sides".
 *
 * Safe to run twice: the second run finds every side visible and restores
 * nothing (sidesToRestore + the "and status='paused'" guard on the update).
 *
 *   npx tsx --env-file=.env.local scripts/restore-hidden-cnic-sides.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/restore-hidden-cnic-sides.ts --apply   # write
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { sidesToRestore, cnicSideOf, type DedupeRow } from '../lib/docLockCore'

export const RESTORE_ACTOR = 'system: restore CNIC sides'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    `select d.id, d.user_id, d.kind, d.label, d.created_at::text as created_at, d.status, p.full_name, p.role
       from user_documents d join profiles p on p.id = d.user_id where d.kind = 'cnic'`,
  )
  const ids = sidesToRestore(rows as DedupeRow[])
  type Row = DedupeRow & { full_name: string | null; role: string }
  const byId = new Map<string, Row>((rows as Row[]).map((r) => [r.id, r]))
  const members = new Set<string>()
  for (const id of ids) {
    const r = byId.get(id)!
    members.add(r.user_id)
    console.log(`${apply ? 'restore' : 'would restore'}: ${r.full_name ?? '(no name)'} | ${r.role} | ${cnicSideOf(r.label)} | uploaded ${r.created_at}`)
  }
  console.log(`members: ${members.size} · sides: ${ids.length}`)
  if (apply && ids.length > 0) {
    await c.query('begin')
    try {
      for (const id of ids) {
        const r = byId.get(id)!
        const up = await c.query(`update user_documents set status = 'active' where id = $1 and status = 'paused'`, [id])
        if (up.rowCount !== 1) continue
        await c.query(
          `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
           values (null, $1, 'system', 'document.restore_side', 'user_document', $2, $3)`,
          [RESTORE_ACTOR, id, JSON.stringify({ memberId: r.user_id, kind: 'cnic', side: cnicSideOf(r.label), uploadedAt: r.created_at })],
        )
      }
      await c.query('commit')
      console.log('COMMITTED')
    } catch (e) {
      await c.query('rollback')
      throw e
    }
  }
  await c.end()
}
main()
