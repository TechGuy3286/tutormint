/**
 * scripts/pr106e-repair.ts
 *
 * PR106-E data repairs (report counts; pause, never delete; never change a real
 * payment). READ/dry-run by default — add `--apply` to COMMIT.
 *
 *   1. selfie_status / profile_pic_status = 'approved' with NO real file → NULL
 *      (so the admin UI reads "Not uploaded"). Presentational columns only;
 *      verification_state is NEVER touched here.
 *   2. CNIC approved-no-file: REPORTED ONLY (verification_state is load-bearing;
 *      the new badge rule already withholds the badge when the file is missing).
 *   3. Duplicate verification_approved notifications → keep the oldest per
 *      (user_id, title, body); pause the rest via meta.paused = true.
 *   4. profile_viewed / viewer_weekly_teaser notifications with NO backing real
 *      parent/academy profile_views row for that tutor → pause via meta.paused.
 *
 * Fee-flag-without-payment accounts are REPORTED for Alee, never changed.
 * The DB URL comes from env and is never printed.
 */
// @ts-expect-error — pg ships no bundled types; this is a dev-only repair script.
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set.')
  process.exit(1)
}

const PARENT_ROLES = `('parent','academy')`

async function main() {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query('begin')

    // ---- 1. selfie approved, no selfie user_documents row -------------------
    // The review-status columns live on PROFILES (not tutor_profiles); the selfie
    // FILE is a user_documents 'selfie' row (same signal badgeFacts uses).
    const selfieBad = await c.query(
      `select p.id, p.full_name
         from profiles p
        where p.role = 'tutor' and p.selfie_status = 'approved'
          and not exists (select 1 from user_documents ud
                           where ud.user_id = p.id and ud.kind = 'selfie')`,
    )
    console.log(`\n[1a] selfie_status=approved with NO selfie file: ${selfieBad.rowCount}`)
    for (const r of selfieBad.rows) console.log(`      ${r.full_name} (${r.id})`)

    const picBad = await c.query(
      `select p.id, p.full_name
         from profiles p
        where p.role = 'tutor' and p.profile_pic_status = 'approved'
          and coalesce(btrim(p.avatar_url), '') = ''`,
    )
    console.log(`[1b] profile_pic_status=approved with NO avatar file: ${picBad.rowCount}`)
    for (const r of picBad.rows) console.log(`      ${r.full_name} (${r.id})`)

    // ---- 2. CNIC approved, no file (REPORT ONLY) ----------------------------
    const cnicBad = await c.query(
      `select p.id, p.full_name, p.verification_state, p.cnic_verified_at,
              p.cnic_number, p.cnic_image_path
         from profiles p
        where p.role = 'tutor'
          and (p.verification_state = 'approved' or p.cnic_verified_at is not null)
          and (coalesce(btrim(p.cnic_number), '') = '' or coalesce(btrim(p.cnic_image_path), '') = '')`,
    )
    console.log(`[2]  CNIC approved with NO file (REPORT ONLY, not changed): ${cnicBad.rowCount}`)
    for (const r of cnicBad.rows)
      console.log(`      ${r.full_name} (${r.id}) state=${r.verification_state} num=${r.cnic_number ? 'y' : 'n'} img=${r.cnic_image_path ? 'y' : 'n'}`)

    // ---- fee flag without a real payment (REPORT ONLY, for Alee) ------------
    const feeNoPay = await c.query(
      `select tp.id, p.full_name, tp.verified_fee_paid_at
         from tutor_profiles tp join profiles p on p.id = tp.id
        where tp.verified_fee_paid_at is not null
          and not exists (select 1 from payments pay
                           where pay.user_id = tp.id and pay.status = 'approved')`,
    )
    console.log(`[FEE] verified_fee_paid_at set with NO approved payment (REPORT for Alee, NOT changed): ${feeNoPay.rowCount}`)
    for (const r of feeNoPay.rows) console.log(`      ${r.full_name} (${r.id})`)

    // ---- 3. duplicate verification_approved notifications -------------------
    // Keep the OLDEST per (user, title, body); the rest are the extras to pause.
    // row_number (created_at asc, id asc) is deterministic even on a timestamp
    // tie and runs entirely in SQL, so the report below and the write use the
    // IDENTICAL set — no JS Date round-trip that would drop microseconds.
    const DUP_EXTRAS = `
      with ranked as (
        select id, user_id, coalesce(title,'') t,
               row_number() over (partition by user_id, coalesce(title,''), coalesce(body,'')
                                  order by created_at asc, id asc) rn
          from notifications
         where kind = 'verification_approved'
           and coalesce((meta->>'paused')::text,'') <> 'true')
      select id, user_id, t from ranked where rn > 1`
    const dupExtras = await c.query(DUP_EXTRAS)
    console.log(`\n[3]  verification_approved extras to pause (keep oldest per group): ${dupExtras.rowCount}`)
    for (const r of dupExtras.rows)
      console.log(`      user=${(r.user_id as string).slice(0, 8)} "${(r.t as string).slice(0, 40)}" id=${(r.id as string).slice(0, 8)}`)

    // ---- 4. unbacked profile-view notifications -----------------------------
    const unbacked = await c.query(
      `select n.id, n.kind, n.user_id, p.full_name
         from notifications n join profiles p on p.id = n.user_id
        where n.kind in ('profile_viewed','viewer_weekly_teaser')
          and coalesce((n.meta->>'paused')::text,'') <> 'true'
          and not exists (
                select 1 from profile_views pv
                 where pv.tutor_id = n.user_id
                   and pv.viewer_role in ${PARENT_ROLES}
                   and pv.viewer_id is distinct from pv.tutor_id)`,
    )
    console.log(`\n[4]  profile-view notifications with NO backing parent/academy view: ${unbacked.rowCount}`)
    const byKind: Record<string, number> = {}
    for (const r of unbacked.rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    console.log(`      by kind: ${JSON.stringify(byKind)}`)

    if (!APPLY) {
      await c.query('rollback')
      console.log('\nDRY RUN — rolled back. Re-run with --apply to COMMIT.')
      return
    }

    // ================= WRITES (inside the open transaction) =================
    const u1 = await c.query(
      `update profiles set selfie_status = null, selfie_reason = null
        where role = 'tutor' and selfie_status = 'approved'
          and not exists (select 1 from user_documents ud
                           where ud.user_id = profiles.id and ud.kind = 'selfie')`,
    )
    const u1b = await c.query(
      `update profiles set profile_pic_status = null, profile_pic_reason = null
        where role = 'tutor' and profile_pic_status = 'approved'
          and coalesce(btrim(avatar_url), '') = ''`,
    )
    // pause duplicate verification_approved extras (keep oldest per group) —
    // the IDENTICAL set the dry-run reported above.
    const u3 = await c.query(
      `update notifications set meta = coalesce(meta,'{}'::jsonb) || '{"paused":true,"paused_by":"pr106e"}'::jsonb
        where id in (select id from (${DUP_EXTRAS}) dq)`,
    )
    const u4 = await c.query(
      `update notifications set meta = coalesce(meta,'{}'::jsonb) || '{"paused":true,"paused_by":"pr106e"}'::jsonb
        where kind in ('profile_viewed','viewer_weekly_teaser')
          and coalesce((meta->>'paused')::text,'') <> 'true'
          and not exists (
                select 1 from profile_views pv
                 where pv.tutor_id = notifications.user_id
                   and pv.viewer_role in ${PARENT_ROLES}
                   and pv.viewer_id is distinct from pv.tutor_id)`,
    )
    await c.query('commit')
    console.log('\nAPPLIED:')
    console.log(`  selfie_status reset:      ${u1.rowCount}`)
    console.log(`  profile_pic_status reset: ${u1b.rowCount}`)
    console.log(`  dup verification paused:  ${u3.rowCount}`)
    console.log(`  unbacked views paused:    ${u4.rowCount}`)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
