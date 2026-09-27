/**
 * scripts/repair-credentials.ts   (PR74 §B repair)
 *
 * Unwraps the corrupted nested-JSON degree/certificate entries to clean fields,
 * keeping the innermost real values and any image, using the SAME parser the app
 * reads with (lib/degrees). Touches ONLY corrupted rows; clean plain-strings and
 * clean objects are left exactly as they are. Dry-run by default.
 *
 *   ALLOW_SEED_ON_PRODUCTION=1 npx tsx scripts/repair-credentials.ts --apply --confirm=<db-ref>
 *
 * degrees is text[] (each cleaned element is written as a JSON object string);
 * certifications is jsonb (written as JSON objects).
 */
// @ts-expect-error — pg ships no bundled types; dev-only repair script.
import pg from 'pg'
import { parseCredential, isCredentialCorrupted } from '../lib/degrees'
import { PRODUCTION_PROJECT_REF } from './target'

const APPLY = process.argv.includes('--apply')
const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.split('=')[1]
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }
const isProd = dbUrl.includes(PRODUCTION_PROJECT_REF)

function cleanDegreeObj(raw: unknown) {
  const c = parseCredential(raw)
  return { title: c.title, institute: c.institute, year: c.year, fileName: c.fileName, fileUrl: c.fileUrl }
}
function cleanCertObj(raw: unknown) {
  const c = parseCredential(raw)
  return { title: c.title, issuer: c.institute, year: c.year, fileName: c.fileName, fileUrl: c.fileUrl }
}

async function main() {
  if (APPLY && isProd && (process.env.ALLOW_SEED_ON_PRODUCTION !== '1' || confirm !== PRODUCTION_PROJECT_REF)) {
    console.error(`Refusing to write to PRODUCTION without ALLOW_SEED_ON_PRODUCTION=1 and --confirm=${PRODUCTION_PROJECT_REF}`)
    process.exit(1)
  }
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  console.log(`${isProd ? 'PRODUCTION' : 'non-prod'} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // ---- degrees (text[]) ----
  const degRows = await client.query<{ id: string; degrees: string[] | null }>(
    `select id, degrees from tutor_profiles where degrees is not null and array_length(degrees,1) > 0`,
  )
  let degTutors = 0
  let degEntries = 0
  for (const r of degRows.rows) {
    const arr = r.degrees ?? []
    if (!arr.some((e: unknown) => isCredentialCorrupted(e))) continue
    degTutors++
    degEntries += arr.filter((e: unknown) => isCredentialCorrupted(e)).length
    const cleaned = arr.map((e: unknown) => (isCredentialCorrupted(e) ? JSON.stringify(cleanDegreeObj(e)) : e))
    if (APPLY) await client.query('update tutor_profiles set degrees = $1 where id = $2', [cleaned, r.id])
  }

  // ---- certifications (jsonb) ----
  const certRows = await client.query<{ id: string; certifications: unknown }>(
    `select id, certifications from tutor_profiles where certifications is not null`,
  )
  let certTutors = 0
  let certEntries = 0
  for (const r of certRows.rows) {
    const arr = Array.isArray(r.certifications) ? (r.certifications as unknown[]) : []
    // A jsonb element may be a string (JSON-in-string) or an object; only the
    // string-nested shape is "corrupted".
    if (!arr.some((e: unknown) => isCredentialCorrupted(e))) continue
    certTutors++
    certEntries += arr.filter((e: unknown) => isCredentialCorrupted(e)).length
    const cleaned = arr.map((e: unknown) => (isCredentialCorrupted(e) ? cleanCertObj(e) : e))
    if (APPLY) await client.query('update tutor_profiles set certifications = $1::jsonb where id = $2', [JSON.stringify(cleaned), r.id])
  }

  await client.end()
  console.log('\n=== repair report ===')
  console.log(`degrees: tutors with corrupted entries = ${degTutors}, corrupted entries = ${degEntries}`)
  console.log(`certifications: tutors with corrupted entries = ${certTutors}, corrupted entries = ${certEntries}`)
  if (!APPLY) console.log('(DRY-RUN — nothing written.)')
}

main().catch((e) => { console.error(e); process.exit(1) })
