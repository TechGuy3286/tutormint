/**
 * scripts/backfill-slots.ts   (PR73 §A backfill)
 *
 * Converts existing free-text schedules to the structured slot model, using the
 * SAME parsers the app uses (lib/timeSlots), so nothing drifts:
 *   - jobs.timings         → jobs.schedule_slots (+ resync timings to the short form)
 *   - tutor_profiles.availability_list (free-text {day,timeSlot}) → slot-label shape
 *
 * Anything unparseable is LEFT in the old column and reported; no availability is
 * dropped. Dry-run by default (reports counts only). To write:
 *   ALLOW_SEED_ON_PRODUCTION=1 npx tsx scripts/backfill-slots.ts --apply --confirm=<db-ref>
 */
// @ts-expect-error — pg ships no bundled types; this is a dev-only backfill script.
import pg from 'pg'
import { parseTimings, formatSlots, readAvailabilityRaw, parseAvailabilityList, slotsToAvailabilityList } from '../lib/timeSlots'
import { PRODUCTION_PROJECT_REF } from './target'

const APPLY = process.argv.includes('--apply')
const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.split('=')[1]
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }
const dbRef = dbUrl.match(/postgres\.([a-z0-9]+)|db\.([a-z0-9]+)\.supabase|@([a-z0-9]+)\./)?.slice(1).find(Boolean) ?? dbUrl.match(/([a-z0-9]{20})/)?.[1]
const isProd = dbUrl.includes(PRODUCTION_PROJECT_REF)

async function main() {
  if (APPLY && isProd) {
    if (process.env.ALLOW_SEED_ON_PRODUCTION !== '1' || confirm !== PRODUCTION_PROJECT_REF) {
      console.error(`Refusing to write to PRODUCTION without ALLOW_SEED_ON_PRODUCTION=1 and --confirm=${PRODUCTION_PROJECT_REF}`)
      process.exit(1)
    }
  }
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  console.log(`target db ref=${dbRef ?? '?'} · ${isProd ? 'PRODUCTION' : 'non-prod'} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // ---- tuitions ----
  const jobs = await client.query<{ id: string; timings: string | null }>(
    `select id, timings from jobs where coalesce(timings,'') <> ''`,
  )
  let jobConverted = 0
  const jobUnparsed: string[] = []
  for (const row of jobs.rows) {
    const slots = parseTimings(row.timings ?? '')
    if (!slots || slots.length === 0) { jobUnparsed.push(row.timings ?? ''); continue }
    jobConverted++
    if (APPLY) {
      await client.query('update jobs set schedule_slots = $1::jsonb, timings = $2 where id = $3', [
        JSON.stringify(slots), formatSlots(slots), row.id,
      ])
    }
  }

  // ---- tutors ----
  const tutors = await client.query<{ id: string; availability_list: string[] | null }>(
    `select id, availability_list from tutor_profiles where availability_list is not null and array_length(availability_list,1) > 0`,
  )
  let tutorConverted = 0
  const tutorUnparsedEntries: string[] = []
  for (const row of tutors.rows) {
    const raw = readAvailabilityRaw(row.availability_list)
    const { slots, unparsed } = parseAvailabilityList(raw)
    if (slots.length === 0 && unparsed.length === 0) continue
    // Parseable → slot labels; unparseable originals appended so nothing is lost.
    const newList = [...slotsToAvailabilityList(slots), ...unparsed.map((u) => JSON.stringify(u))]
    if (slots.length > 0) tutorConverted++
    for (const u of unparsed) tutorUnparsedEntries.push(`${u.day} ${u.timeSlot}`)
    if (APPLY) {
      await client.query('update tutor_profiles set availability_list = $1 where id = $2', [newList, row.id])
    }
  }

  await client.end()
  console.log('\n=== backfill report ===')
  console.log(`tuitions with timings: ${jobs.rows.length} · converted to slots: ${jobConverted} · unparseable (kept): ${jobUnparsed.length}`)
  if (jobUnparsed.length) console.log('  unparseable timings:', [...new Set(jobUnparsed)].slice(0, 30))
  console.log(`tutors with availability: ${tutors.rows.length} · converted (≥1 slot): ${tutorConverted}`)
  console.log(`  unparseable availability entries (kept): ${tutorUnparsedEntries.length}`, tutorUnparsedEntries.slice(0, 30))
  if (!APPLY) console.log('\n(DRY-RUN — no rows written. Re-run with --apply --confirm=<ref>.)')
}

main().catch((e) => { console.error(e); process.exit(1) })
