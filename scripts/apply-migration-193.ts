/**
 * scripts/apply-migration-193.ts — applies supabase/migrations/193_applications_v2.sql
 * and, in the SAME transaction:
 *   - gives every tuition no staff member posted its city's owner (Alee, the
 *     site Owner, where the city has none) — lib/cityOwnersCore, one
 *     job.owner_assign audit row per tuition, actor "system: city owners";
 *   - backfills past parent hires: an application whose tutor the parent hired
 *     (jobs.hired_tutor_id, or applications.status 'hired') becomes Hired,
 *     recorded as changed by "Parent", with the stage history, the tuition's
 *     audit row and the tutor's timeline.
 * Without --apply it rolls back. Runs the SQL twice (idempotent), checks no jobs
 * row changed and no application changed except worked_* / a backfilled hire,
 * proves a signed-in tutor cannot change worked_at, and prints the counts the
 * owner asked for: owners before/after, the Older count, overdue per staff
 * member. No phone, CNIC or email is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-193.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { CITY_OWNER_SEED, cityKey, cityOwnerFor, cityRuleApplies } from '../lib/cityOwnersCore'
import { isOlderTuition, itemOverdue, overdueFlag, type Stage } from '../lib/applicationStageCore'

const ACTOR = 'system: city owners'

const COUNTED = `a.withdrawn_at is null
  and coalesce(p.role::text, '') <> 'admin'
  and not coalesce(p.is_seed, false) and not coalesce(p.is_team_account, false)
  and not coalesce(p.is_test_name, false) and not coalesce(p.hidden_from_public, false)`

type C = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[]; rowCount: number }> }

async function ownerCounts(c: C) {
  return (
    await c.query(`
      select coalesce(s.full_name, '(unassigned)') owner, count(*)::int tuitions
        from jobs j
        left join tuition_owners o on o.job_id = j.id
        left join profiles s on s.id = o.staff_id
       group by 1 order by 2 desc, 1`)
  ).rows
}

async function overduePerStaff(c: C, now: number, oldRule = false) {
  const rows = (
    await c.query(`
      select a.id, a.stage, a.stage_changed_at, ${oldRule ? "null::timestamptz" : "a.worked_at"} worked_at, a.created_at, j.created_at job_created_at,
             coalesce(s.full_name, '(unassigned)') owner
        from applications a
        join profiles p on p.id = a.tutor_id
        join jobs j on j.id = a.job_id
        left join tuition_owners o on o.job_id = a.job_id
        left join profiles s on s.id = o.staff_id
       where ${COUNTED}`)
  ).rows
  const per: Record<string, number> = {}
  let older = 0
  let overdue = 0
  for (const r of rows) {
    const item = {
      id: r.id,
      stage: r.stage as Stage,
      stageChangedAt: r.stage_changed_at?.toISOString?.() ?? null,
      workedAt: r.worked_at?.toISOString?.() ?? null,
      createdAt: r.created_at.toISOString(),
      jobCreatedAt: r.job_created_at.toISOString(),
      ownerId: null,
    }
    if (isOlderTuition(item.jobCreatedAt, now)) older++
    if (oldRule ? overdueFlag(item.stage, item.stageChangedAt, now) : itemOverdue(item, now)) {
      overdue++
      per[r.owner] = (per[r.owner] ?? 0) + 1
    }
  }
  return { counted: rows.length, older, overdue, per }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/193_applications_v2.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const now = Date.now()
    const jobsFp = `select count(*)::int n, md5(string_agg(id::text || status || coalesce(paused_at::text,'') || coalesce(resumed_at::text,'') || coalesce(hired_tutor_id::text,''), ',' order by id)) h from jobs`
    const appsFp = `select count(*)::int n, md5(string_agg(id::text || coalesce(job_id::text,'') || tutor_id::text || status || coalesce(withdrawn_at::text,''), ',' order by id)) h from applications`
    const jBefore = (await c.query(jobsFp)).rows[0]
    const aBefore = (await c.query(appsFp)).rows[0]
    const ownersBefore = await ownerCounts(c)
    const overdueBefore = await overduePerStaff(c, now, true)

    await c.query(sql)
    await c.query(sql)

    // Seed result: every owner-list city must be mapped, else say which.
    const mapped = (await c.query(`select c.city, s.full_name from city_owners c left join profiles s on s.id = c.staff_id order by c.city`)).rows
    const mappedSet = new Set(mapped.filter((m: any) => m.full_name).map((m: any) => m.city))
    const unmapped = CITY_OWNER_SEED.flatMap((r) => r.cities.filter((city) => !mappedSet.has(city)).map((city) => `${city} (${r.name})`))
    console.log(`city owners seeded: ${mapped.length}; unmapped: ${unmapped.length ? unmapped.join(', ') : 'none'}`)
    const knownCities = new Set((await c.query(`select name from location_cities`)).rows.map((r: any) => r.name))
    const notCities = CITY_OWNER_SEED.flatMap((r) => r.cities).filter((x) => !knownCities.has(x))
    if (notCities.length) console.log('cities not in location_cities:', notCities)

    // City rule.
    const siteOwner = (await c.query(`select id from profiles where role = 'admin' and admin_role = 'owner' limit 1`)).rows[0]?.id
    if (!siteOwner) throw new Error('no site Owner account')
    const map = new Map<string, string>(mapped.filter((m: any) => m.full_name).map((m: any) => [cityKey(m.city), '']))
    for (const r of (await c.query(`select city, staff_id from city_owners where staff_id is not null`)).rows) map.set(cityKey(r.city), r.staff_id)
    const jobs = (await c.query(`select j.id, j.city, o.staff_id, o.source, o.posted_by, (o.job_id is not null) has_row from jobs j left join tuition_owners o on o.job_id = j.id`)).rows
    let assigned = 0
    const toSiteOwner: string[] = []
    for (const j of jobs) {
      const row = j.has_row ? { staffId: j.staff_id, source: j.source, postedBy: j.posted_by } : undefined
      if (!cityRuleApplies(row)) continue
      const to = cityOwnerFor(j.city, map, siteOwner)
      if (row && row.staffId === to && row.source === 'city') continue
      await c.query(
        `insert into tuition_owners (job_id, staff_id, source, assigned_by, assigned_by_name, assigned_at)
         values ($1, $2, 'city', null, $3, now())
         on conflict (job_id) do update set staff_id = excluded.staff_id, source = 'city', assigned_by = null,
           assigned_by_name = excluded.assigned_by_name, assigned_at = now()`,
        [j.id, to, ACTOR],
      )
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values (null, $1, 'owner', 'job.owner_assign', 'job', $2, $3)`,
        [ACTOR, j.id, JSON.stringify({ from: row?.staffId ?? null, to, city: j.city, rule: map.has(cityKey(j.city)) ? 'city owner' : 'no city owner — site Owner' })],
      )
      assigned++
      if (!map.has(cityKey(j.city))) toSiteOwner.push(j.city ?? '(no city)')
    }
    console.log(`city rule: ${assigned} tuitions assigned; ${toSiteOwner.length} to the site Owner (cities: ${[...new Set(toSiteOwner)].join(', ') || 'none'})`)
    const staffPostedTouched = (await c.query(`select count(*)::int n from tuition_owners where posted_by is not null and source = 'city'`)).rows[0].n
    if (staffPostedTouched) throw new Error('a staff-posted tuition was given to a city owner')

    // Parent-hire backfill.
    const hires = (
      await c.query(`
        select a.id, a.job_id, a.tutor_id, a.stage, j.parent_id, coalesce(j.hired_at, a.status_changed_at, now()) at
          from applications a join jobs j on j.id = a.job_id
         where a.withdrawn_at is null and a.stage <> 'hired'
           and (j.hired_tutor_id = a.tutor_id or a.status = 'hired')`)
    ).rows
    for (const h of hires) {
      await c.query(
        `update applications set stage = 'hired', stage_changed_at = $2, stage_changed_by = $3, stage_changed_by_name = 'Parent',
           worked_at = $2, worked_by = $3, worked_by_name = 'Parent' where id = $1`,
        [h.id, h.at, h.parent_id],
      )
      await c.query(
        `insert into application_stage_events (application_id, job_id, tutor_id, from_stage, to_stage, staff_id, staff_name, created_at)
         values ($1, $2, $3, $4, 'hired', null, 'Parent', $5)`,
        [h.id, h.job_id, h.tutor_id, h.stage, h.at],
      )
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1, null, 'member', 'application.stage', 'job', $2, $3)`,
        [h.parent_id, h.job_id, JSON.stringify({ applicationId: h.id, tutorId: h.tutor_id, from: h.stage, to: 'hired', reason: 'parent hired (backfill)', by: 'parent' })],
      )
      await c.query(
        `insert into user_activity_log (user_id, event_type, target_type, target_id, metadata) values ($1, 'application_stage_changed', 'application', $2, $3)`,
        [h.tutor_id, h.id, JSON.stringify({ jobId: h.job_id, from: h.stage, to: 'hired', stage: 'Hired', by: 'parent' })],
      )
    }
    console.log(`past parent hires backfilled: ${hires.length}`)

    const jAfter = (await c.query(jobsFp)).rows[0]
    const aAfter = (await c.query(appsFp)).rows[0]
    if (jBefore.n !== jAfter.n || jBefore.h !== jAfter.h) throw new Error('a jobs row changed')
    if (aBefore.n !== aAfter.n || aBefore.h !== aAfter.h) throw new Error('an application changed beyond its stage/activity columns')

    // The lock: a signed-in tutor cannot set worked_at.
    const one = (await c.query(`select id, tutor_id from applications limit 1`)).rows[0]
    if (one) {
      await c.query('savepoint lock_probe')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: one.tutor_id, role: 'authenticated' })])
      await c.query(`set local role authenticated`)
      let refused = false
      try {
        await c.query(`update applications set worked_at = now() where id = $1`, [one.id])
      } catch (e) {
        refused = (e as { code?: string }).code === '42501'
      }
      await c.query('rollback to savepoint lock_probe')
      if (!refused) throw new Error('a signed-in tutor could change worked_at')
      console.log('lock: a signed-in tutor is refused (42501)')
    }

    console.log('owners BEFORE:', ownersBefore)
    console.log('owners AFTER :', await ownerCounts(c))
    const after = await overduePerStaff(c, now)
    console.log(`counted applications: ${after.counted}`)
    console.log(`overdue BEFORE (old rule): ${overdueBefore.overdue}`, overdueBefore.per)
    console.log(`Older section (tuitions posted > 30 days ago): ${after.older}`)
    console.log(`overdue AFTER: ${after.overdue}`, after.per)

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
