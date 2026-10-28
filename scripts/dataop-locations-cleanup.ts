/**
 * scripts/dataop-locations-cleanup.ts — the Locations clean-up (owner, 28 Oct 2026).
 *
 * Puts every free-text location into a bucket (lib/locationBucketsCore):
 *   auto      applied by this script with --apply (each one logged with Undo)
 *   suggest   left for the Owner: pre-filled on Admin → Locations
 *   new_area  left for the Owner: "Add as new area"
 *   not_area  left for the Owner: "Not an area"
 *
 * Without --apply it only READS: prints the counts per bucket and every
 * would-be automatic merge, and writes nothing.
 *
 * With --apply it applies ONLY the 'auto' area merges, in ONE transaction, with
 * the same meaning as the review screen:
 *   - a typed value  → a spelling row in location_area_aliases (the text on
 *     tuitions and profiles is never rewritten);
 *   - an area staff added → its name becomes a spelling of the other area, the
 *     spellings that pointed at it move over, and it is RETIRED (removed_at) —
 *     exactly lib/staffAreas mergeStaffArea.
 * One admin_audit_log row per merge (action location.auto_merge, actor = the
 * Owner account, detail.note "automatic clean-up 28 Oct 2026") holds everything
 * needed to undo it; Admin → Locations → Automatic merges has the Undo.
 * Nothing is deleted. City spellings are REPORTED only: there is no city
 * spelling table that can be taken back without deleting a row.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-locations-cleanup.ts            (dry run)
 *   npx tsx --env-file=.env.local scripts/dataop-locations-cleanup.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { areaKey, type CityAliases } from '../lib/areaHubCore'
import { AUTO_CLEANUP_NOTE, autoMergeLine, bucketArea, bucketCity, type AutoMergeRecord, type Bucket, type BucketResult } from '../lib/locationBucketsCore'

const APPLY = process.argv.includes('--apply')
const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

type Area = { id: number; name: string; city_id: number; created_by: string | null }

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const q = async <T,>(sql: string, args: unknown[] = []) => ((await c.query(sql, args)) as { rows: T[] }).rows

    const cities = await q<{ id: number; name: string }>(`select id, name from location_cities`)
    const cityByName = new Map(cities.map((x) => [low(x.name), x]))
    const cityById = new Map(cities.map((x) => [x.id, x]))
    const areas = await q<Area>(`select id, name, city_id, created_by::text from location_areas where removed_at is null`)
    const aliases = await q<{ id: number; city_id: number; raw: string; area_id: number }>(`select id, city_id, raw, area_id from location_area_aliases where removed_at is null`)
    const ignored = await q<{ city: string; raw: string }>(`select city, raw from location_ignored where removed_at is null`)
    const kept = new Set((await q<{ ref_id: string }>(`select ref_id::text from location_run_reviews where kind = 'area' and decision = 'keep'`)).map((r) => Number(r.ref_id)))

    const areaById = new Map(areas.map((a) => [a.id, a]))
    const areasOfCity = new Map<number, Area[]>()
    for (const a of areas) (areasOfCity.get(a.city_id) ?? areasOfCity.set(a.city_id, []).get(a.city_id)!).push(a)
    const aliasesOfCity = (cityId: number): CityAliases => {
      const m: CityAliases = {}
      const city = cityById.get(cityId)?.name ?? ''
      for (const al of aliases) {
        if (al.city_id !== cityId) continue
        const into = areaById.get(al.area_id)
        if (into) m[areaKey(al.raw, city)] = into.name
      }
      return m
    }
    const cityNames = cities.map((x) => x.name)
    const waitingStaff = areas.filter((a) => a.created_by && !kept.has(a.id))
    const waitingIds = new Set(waitingStaff.map((a) => a.id))

    const counts: Record<'staff' | 'typed' | 'city', Record<Bucket, number>> = {
      staff: { auto: 0, suggest: 0, new_area: 0, not_area: 0 },
      typed: { auto: 0, suggest: 0, new_area: 0, not_area: 0 },
      city: { auto: 0, suggest: 0, new_area: 0, not_area: 0 },
    }

    // 1. Areas staff added while posting.
    type StaffMerge = { from: Area; into: Area; res: BucketResult }
    const staffMerges: StaffMerge[] = []
    const staffLines: string[] = []
    for (const a of waitingStaff) {
      const city = cityById.get(a.city_id)?.name ?? ''
      // Candidates: the city's other live areas, not other areas still waiting.
      const others = (areasOfCity.get(a.city_id) ?? []).filter((x) => x.id !== a.id && !waitingIds.has(x.id))
      const otherNames = new Set(others.map((x) => low(x.name)))
      const spellings = Object.fromEntries(Object.entries(aliasesOfCity(a.city_id)).filter(([, v]) => otherNames.has(low(v))))
      const res = bucketArea({ value: a.name, city, areas: others.map((x) => x.name), aliases: spellings, cities: cityNames, cityListed: true })
      counts.staff[res.bucket]++
      staffLines.push(`  [${res.bucket}] “${a.name}” (${city}) → ${res.target ?? '—'} · ${res.reason}`)
      if (res.bucket === 'auto' && res.target) {
        const into = others.find((x) => low(x.name) === low(res.target))
        if (into) staffMerges.push({ from: a, into, res })
      }
    }
    const retiredInto = new Map(staffMerges.map((m) => [m.from.id, m.into]))

    // 2. Areas tutors and parents typed (the same list Admin → Locations reads).
    const aliased = new Set(aliases.map((al) => `${low(cityById.get(al.city_id)?.name)}|${low(al.raw)}`))
    const ign = new Set(ignored.map((i) => `${low(i.city)}|${low(i.raw)}`))
    const typed = new Map<string, { value: string; city: string; n: number }>()
    const typedCities = new Map<string, { value: string; n: number }>()
    const take = (city: string | null, area: string | null) => {
      const ct = (city ?? '').trim()
      if (ct && !cityByName.has(low(ct))) {
        const cur = typedCities.get(low(ct)) ?? { value: ct, n: 0 }
        cur.n++
        typedCities.set(low(ct), cur)
      }
      const ar = (area ?? '').trim()
      if (!ar) return
      const cr = cityByName.get(low(ct))
      if (cr && (areasOfCity.get(cr.id) ?? []).some((x) => low(x.name) === low(ar))) return
      const key = `${low(ct)}|${low(ar)}`
      if (aliased.has(key) || ign.has(key)) return
      const cur = typed.get(key) ?? { value: ar, city: ct, n: 0 }
      cur.n++
      typed.set(key, cur)
    }
    for (const t of ['jobs', 'tutor_profiles', 'profiles', 'tutor_areas']) {
      const rows = await q<{ city: string | null; area: string | null }>(`select city, area from ${t}`)
      for (const r of rows) take(r.city, r.area)
    }

    type TypedMerge = { value: string; city: { id: number; name: string }; into: Area; res: BucketResult; n: number }
    const typedMerges: TypedMerge[] = []
    const samples: Record<Bucket, string[]> = { auto: [], suggest: [], new_area: [], not_area: [] }
    for (const t of typed.values()) {
      const cr = cityByName.get(low(t.city))
      const list = cr ? (areasOfCity.get(cr.id) ?? []) : []
      const res = bucketArea({ value: t.value, city: t.city, areas: list.map((x) => x.name), aliases: cr ? aliasesOfCity(cr.id) : null, cities: cityNames, cityListed: !!cr })
      counts.typed[res.bucket]++
      if (samples[res.bucket].length < 12 && res.bucket !== 'auto') samples[res.bucket].push(`“${t.value}” (${t.city || 'no city'}) → ${res.target ?? '—'} · ${res.reason}`)
      if (res.bucket === 'auto' && res.target && cr) {
        let into = list.find((x) => low(x.name) === low(res.target))
        if (into && retiredInto.has(into.id)) into = retiredInto.get(into.id)!
        if (into) typedMerges.push({ value: t.value, city: cr, into, res, n: t.n })
      }
    }

    // 3. Cities typed that are not in the list (reported only).
    const cityLines: string[] = []
    for (const t of typedCities.values()) {
      const res = bucketCity(t.value, cityNames)
      counts.city[res.bucket]++
      cityLines.push(`  [${res.bucket}] “${t.value}” (${t.n}) → ${res.target ?? '—'} · ${res.reason}`)
    }

    console.log(`Locations clean-up — ${APPLY ? 'APPLY' : 'dry run (nothing written)'}`)
    for (const [k, v] of Object.entries(counts)) {
      const label = k === 'staff' ? 'Areas added by staff' : k === 'typed' ? 'Areas typed by tutors and parents' : 'Cities not in the list'
      console.log(`${label}: auto ${v.auto} · suggest ${v.suggest} · new area ${v.new_area} · not an area ${v.not_area}`)
    }
    console.log(`\nAutomatic merges (${staffMerges.length + typedMerges.length}):`)
    for (const m of staffMerges) console.log('  ' + autoMergeLine({ kind: 'staff_area', value: m.from.name, city: cityById.get(m.from.city_id)?.name ?? '', intoName: m.into.name, confidence: m.res.confidence }) + ` — ${m.res.reason}`)
    for (const m of typedMerges) console.log('  ' + autoMergeLine({ kind: 'typed', value: m.value, city: m.city.name, intoName: m.into.name, confidence: m.res.confidence }) + ` — ${m.res.reason} (used ${m.n}×)`)
    console.log('\nAreas added by staff (every one):')
    for (const l of staffLines) console.log(l)
    console.log('\nCities (reported, never applied):')
    for (const l of cityLines) console.log(l)
    for (const b of ['suggest', 'new_area', 'not_area'] as const) {
      console.log(`\nSample — typed, ${b}:`)
      for (const s of samples[b]) console.log('  ' + s)
    }

    if (!APPLY) {
      console.log('\nDry run — nothing written. Re-run with --apply to apply the automatic merges only.')
      return
    }

    const [owner] = await q<{ id: string; email: string | null }>(`select id::text, email from profiles where role = 'admin' and admin_role = 'owner' limit 1`)
    if (!owner) throw new Error('No owner account.')
    await c.query('begin')
    let done = 0
    const audit = async (rec: AutoMergeRecord) => {
      await c.query(
        `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail) values ($1, 'owner', $2, 'location.auto_merge', 'location', $3, $4)`,
        [owner.id, owner.email, String(rec.intoAreaId), JSON.stringify({ ...rec, before: 'Free text', after: rec.intoName, undo: 'Admin → Locations → Automatic merges → Undo puts this back exactly' })],
      )
      done++
    }
    try {
      for (const m of staffMerges) {
        const city = cityById.get(m.from.city_id)!
        const ins = await q<{ id: string }>(
          `insert into location_area_aliases (city_id, raw, area_id, created_by, created_by_email) values ($1, $2, $3, $4, $5) on conflict do nothing returning id::text`,
          [city.id, m.from.name, m.into.id, owner.id, owner.email],
        )
        if (!ins[0]) {
          console.log(`  skipped (spelling already saved): ${m.from.name}`)
          continue
        }
        const moved = await q<{ id: string }>(
          `update location_area_aliases set area_id = $1 where area_id = $2 and removed_at is null and id <> $3 returning id::text`,
          [m.into.id, m.from.id, ins[0].id],
        )
        await c.query(`update location_areas set removed_at = now(), removed_by = $1 where id = $2 and removed_at is null`, [owner.id, m.from.id])
        await audit({
          kind: 'staff_area',
          city: city.name,
          cityId: city.id,
          value: m.from.name,
          intoAreaId: m.into.id,
          intoName: m.into.name,
          confidence: m.res.confidence,
          reason: m.res.reason,
          aliasId: Number(ins[0].id),
          retiredAreaId: m.from.id,
          movedAliasIds: moved.map((r) => Number(r.id)),
          note: AUTO_CLEANUP_NOTE,
        })
      }
      for (const m of typedMerges) {
        const ins = await q<{ id: string }>(
          `insert into location_area_aliases (city_id, raw, area_id, created_by, created_by_email) values ($1, $2, $3, $4, $5) on conflict do nothing returning id::text`,
          [m.city.id, m.value, m.into.id, owner.id, owner.email],
        )
        if (!ins[0]) {
          console.log(`  skipped (spelling already saved): ${m.value}`)
          continue
        }
        await audit({
          kind: 'typed',
          city: m.city.name,
          cityId: m.city.id,
          value: m.value,
          intoAreaId: m.into.id,
          intoName: m.into.name,
          confidence: m.res.confidence,
          reason: m.res.reason,
          aliasId: Number(ins[0].id),
          note: AUTO_CLEANUP_NOTE,
        })
      }
      await c.query('commit')
      console.log(`\nApplied ${done} automatic merges. Each is in the Audit log with its Undo.`)
    } catch (e) {
      await c.query('rollback')
      throw e
    }
  } finally {
    await c.end()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
