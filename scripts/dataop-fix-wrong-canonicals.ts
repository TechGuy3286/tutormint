/**
 * scripts/dataop-fix-wrong-canonicals.ts  (owner, 13 Oct 2026)
 *
 * Open tuitions whose canonical pointed at an unrelated tuition. The 6 Oct
 * duplicate rule called two open posts repeats on "same title in the same
 * place" or "same city + area + levels + subjects + gender + budget" — it never
 * looked at the Job Type or the contact number. The rule is now
 * lib/duplicatesCore.sameRequirement.
 *
 * This reads every OPEN tuition and reports, with both rules:
 *   - flagged before (wrong or right), flagged now (real repeats),
 *   - FIXED = flagged before, not now: these get a self canonical and their
 *     JobPosting back from the code change alone.
 * With --apply it ONLY adds one URL_UPDATED row per fixed tuition to
 * indexing_queue (the existing queue sends it). No tuition row is changed.
 * Safe to run twice: a URL already waiting as URL_UPDATED is not queued again.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-fix-wrong-canonicals.ts
 *   npx tsx --env-file=.env.local scripts/dataop-fix-wrong-canonicals.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { duplicateReasons, legacyDuplicateReasons, type DuplicateFacts } from '../lib/duplicatesCore'
import { tuitionContactNumber } from '../lib/tuitionContactCore'
import { citySegment } from '../lib/slugs'

const SITE = 'https://www.tutormint.org'

type Row = DuplicateFacts & { refId: string; slug: string | null }

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows } = await c.query(
    `select j.id, j.ref_id, j.title, j.public_slug, j.city, j.area, j.class_levels, j.class_level, j.gender_preference,
            j.budget_pkr, j.budget_min_pkr, j.budget_max_pkr, j.created_at, j.grade_subjects, j.teaching_mode,
            coalesce(p.is_team_account, false) as is_team, p.phone_number, p.phone_verified_at,
            jc.contact_phone, jc.contact_whatsapp,
            coalesce((select array_agg(js.master_id order by js.master_id) from job_subjects js where js.job_id = j.id), '{}') as master_ids
       from jobs j
       left join profiles p on p.id = j.parent_id
       left join job_contacts jc on jc.job_id = j.id
      where j.status = 'open'
      order by j.created_at, j.id`,
  )
  const facts: Row[] = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    refId: r.ref_id as string,
    slug: (r.public_slug as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    classLevels: (r.class_levels as string[] | null) ?? null,
    classLevel: (r.class_level as string | null) ?? null,
    masterIds: ((r.master_ids as (number | string)[]) ?? []).map(Number),
    genderPreference: (r.gender_preference as string | null) ?? null,
    budgetPkr: (r.budget_pkr as number | null) ?? null,
    budgetMinPkr: (r.budget_min_pkr as number | null) ?? null,
    budgetMaxPkr: (r.budget_max_pkr as number | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    gradeSubjects: (r.grade_subjects as DuplicateFacts['gradeSubjects']) ?? null,
    jobType: (r.teaching_mode as string | null) ?? null,
    contact: tuitionContactNumber({
      isTeam: !!r.is_team,
      contactPhone: r.contact_phone as string | null,
      contactWhatsapp: r.contact_whatsapp as string | null,
      parentPhone: r.phone_number as string | null,
      parentPhoneVerifiedAt: r.phone_verified_at ? String(r.phone_verified_at) : null,
    }),
  }))

  // The oldest OLDER open tuition each rule calls the original (what the page did).
  const originalBy = (f: Row, rule: (a: DuplicateFacts, b: DuplicateFacts) => unknown[]) =>
    facts.find((o) => o.id !== f.id && o.createdAt < f.createdAt && rule(f, o).length > 0) ?? null

  const before: { f: Row; o: Row; why: string }[] = []
  const now: { f: Row; o: Row }[] = []
  for (const f of facts) {
    const ob = originalBy(f, legacyDuplicateReasons)
    if (ob) before.push({ f, o: ob, why: legacyDuplicateReasons(f, ob).join(' + ') })
    const on = originalBy(f, duplicateReasons)
    if (on) now.push({ f, o: on })
  }
  const nowIds = new Set(now.map((x) => x.f.id))
  const fixed = before.filter((x) => !nowIds.has(x.f.id))
  const moved = before.filter((x) => nowIds.has(x.f.id) && now.find((n) => n.f.id === x.f.id)!.o.id !== x.o.id)

  const why = (f: Row, o: Row): string => {
    const out: string[] = []
    if ((f.jobType ?? '') !== (o.jobType ?? '')) out.push(`Job Type "${f.jobType}" vs "${o.jobType}"`)
    if (!f.contact || !o.contact) out.push('a contact number is missing')
    else if (f.contact !== o.contact) out.push('different contact numbers')
    return out.join('; ') || 'other field differs'
  }

  console.log(`open tuitions: ${facts.length}`)
  console.log(`canonical pointed at another tuition BEFORE: ${before.length}`)
  console.log(`real repeats NOW (canonical to the original, no JobPosting, out of the sitemap): ${now.length}`)
  for (const x of now) console.log(`  repeat ${x.f.refId} -> original ${x.o.refId} | ${x.f.title}`)
  if (moved.length > 0) console.log(`  (of these, ${moved.length} now point at a different original than before)`)
  console.log(`FIXED (self canonical + JobPosting back): ${fixed.length}`)
  for (const x of fixed) console.log(`  ${x.f.refId} (was -> ${x.o.refId}, old rule: ${x.why}) — ${why(x.f, x.o)} | ${x.f.title} | ${x.f.slug}`)
  console.log(`FIXED TM numbers: ${fixed.map((x) => x.f.refId).join(', ')}`)

  const urls = fixed.filter((x) => x.f.slug).map((x) => `${SITE}/tuitions/${citySegment(x.f.city)}/${x.f.slug}`)
  const waiting = new Set(
    ((await c.query(`select url from indexing_queue where kind = 'URL_UPDATED' and sent_at is null`)).rows as { url: string }[]).map((r) => r.url),
  )
  const todo = urls.filter((u) => !waiting.has(u))
  console.log(`URL_UPDATED notices to queue: ${todo.length} (already waiting: ${urls.length - todo.length})`)

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply AFTER the deploy.')
    await c.end()
    return
  }
  await c.query('begin')
  try {
    for (const u of todo) await c.query(`insert into indexing_queue (url, kind) values ($1, 'URL_UPDATED')`, [u])
    await c.query('commit')
    console.log(`Queued ${todo.length} URL_UPDATED notices.`)
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
