/**
 * scripts/build-pk-cities.ts — npx tsx scripts/build-pk-cities.ts
 *
 * Every Pakistani city and town on the city list (owner, 20 Oct 2026).
 *
 * Reads the GeoNames extract supabase/seed/pk-cities-geonames.tsv (CC BY 4.0;
 * how it was cut is in its header) and writes:
 *   lib/pkCityData.ts                         — name, province, district,
 *       coordinates, population and search aliases for every city (generated)
 *   supabase/migrations/188_all_pk_cities.sql — the new names into
 *       location_cities, stored exactly like the existing 26 (name +
 *       sort_order 100), and the aliases into taxonomy_aliases (kind 'city')
 *
 * The 2023 census list of urban areas (PBS) is published only as per-district
 * PDFs, so GeoNames is the source. Every curation decision is below, named by
 * GeoNames id, so it can be reviewed and re-run: commit the extract, this file
 * and both outputs together.
 *
 * Rules:
 *   - The existing 26 keep their name, sort order, coordinates and province.
 *     They get a district and a population here for the picker only.
 *   - Spelling: the common English form (RENAME); the GeoNames spelling becomes
 *     an alias.
 *   - Two places with one name: the existing (or larger) one keeps the plain
 *     name, the other shows its district — "Sahiwal (Sargodha)".
 *   - Nothing is merged by distance: Kotri and Rohri are their own towns.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { slugify } from '../lib/slugs'
import { HAND_CITY_COORDS } from '../lib/cityCoordsHand'

const SRC = 'supabase/seed/pk-cities-geonames.tsv'
const OUT_TS = 'lib/pkCityData.ts'
const OUT_SQL = 'supabase/migrations/188_all_pk_cities.sql'

// ---------------------------------------------------------------- curation

/** The 26 cities already on the list → their GeoNames id (Wah Cantt has none). */
const EXISTING: Record<string, string | null> = {
  Lahore: '1172451', Karachi: '1174872', Islamabad: '1176615', Rawalpindi: '1166993',
  Abbottabad: null, Bahawalpur: null, 'Dera Ghazi Khan': '1180289', Faisalabad: null,
  Gujranwala: null, Gujrat: null, Hyderabad: null, Jhang: '1175892', Jhelum: null,
  Larkana: null, Mardan: null, Mingora: '1170395', Multan: null, Peshawar: null,
  Quetta: null, 'Rahim Yar Khan': '1167460', Sahiwal: '1166548', Sargodha: null,
  Sheikhupura: '1165221', Sialkot: null, Sukkur: null, 'Wah Cantt': null,
}
/** sort_order of the 26 today: the big four pinned 1..4, the rest 100. */
const PINNED = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi']
/** Districts for existing cities GeoNames does not carry. */
const EXISTING_DISTRICT: Record<string, string> = { 'Wah Cantt': 'Rawalpindi' }

/** Left out, with the reason (reported to the owner). */
const EXCLUDE: Record<string, string> = {
  '1170157': 'Model Town — a neighbourhood of Lahore',
  '1175453': 'Kahna Nau — part of Lahore',
  '1171006': 'Manhala — a village in Lahore district',
  '1166480': 'Saidpur — a village inside Islamabad',
  '1184644': 'Alipur — a village inside Islamabad',
  '11250625': 'Arif Wala (Lasbela) — a GeoNames copy of Arifwala, Punjab',
  '1332083': 'Bahawalnagar (Okara district) — a GeoNames copy of Bahawalnagar',
  '1175082': 'Kamra (Rawalpindi district) — not a known town; Kamra is in Attock',
  '1359673': 'Kurkali Sindh Pakistan — not a recognisable place name',
  '1385128': 'Musa Banda/Musa khan kallay — a village with an unclear name',
  '1177064': 'Chak 31/11-L — a numbered village',
  '1162572': 'Chak 575 — a numbered village',
  '1175098': 'Chak 129-L — a numbered village',
  '1387846': 'Chak 138/9-L — a numbered village',
  '11124382': 'Nowshera Kalan — the same town as Nowshera',
  '1341204': 'Nowshera Cantonment — part of Nowshera',
  '6457378': 'Malakwal City — the same town as Malakwal',
  '9030991': 'Hattian Bala — listed twice',
  '7536245': 'Athmuqam — listed twice',
  '1330335': 'Jhang City — the same city as Jhang',
}
/** A town listed twice: its population moves to the entry kept. */
const POPULATION_FROM: Record<string, string> = { '1168864': '11124382' } // Nowshera ← Nowshera Kalan

/** GeoNames spelling → the common English spelling (by id). */
const RENAME: Record<string, string> = {
  '1175892': 'Jhang', // Jhang Sadr
  '1165221': 'Sheikhupura', // Shekhupura
  '1184249': 'Attock', // Attock City
  '1176948': 'Hazro', // Hazro City
  '1162813': 'Vehari', // Vihari
  '1166652': 'Sadiqabad', // Saddiqabad
  '1162004': 'Khairpur', // Khairpur Mir's
  '1172339': 'Lakki Marwat', // Lakki
  '1179757': 'Dir', // Upper Dir
  '1169027': 'Mirpur (Azad Kashmir)', // New Mirpur City
  '1448637': 'Risalpur', // Risalpur Cantonment
  '1412008': 'Setharja', // Setharja Old
  '1162959': 'Umerkot', // Umarkot
  '1169143': 'Naushahro Feroze', // Naushahro Firoz
  '1165638': 'Shahdadkot', // Shahdad Kot
  '1183090': 'Batkhela', // Bat Khela
  '1177063': 'Hasan Abdal', // Hassan Abdal
  '1180436': 'Daska', // Daska Kalan
  '10944629': 'Athmuqam', // Athhmuqam
  '1167507': 'Chenab Nagar', // Rabwah (official name since 1999)
  '1171376': 'Malakwal',
}

/** Known other spellings, searchable in the picker and in site search. */
const ALIASES: Record<string, string[]> = {
  Lahore: ['Lhr', 'Lahor'],
  Karachi: ['Khi'],
  Islamabad: ['Isb', 'Islambad'],
  Rawalpindi: ['Pindi', 'Rwp'],
  Faisalabad: ['Faislabad', 'Lyallpur', 'Fsd'],
  'Dera Ismail Khan': ['D.I. Khan', 'DI Khan', 'D I Khan'],
  'Dera Ghazi Khan': ['D.G. Khan', 'DG Khan', 'D G Khan'],
  Nawabshah: ['Shaheed Benazirabad', 'Benazirabad'],
  'Rahim Yar Khan': ['R.Y. Khan', 'RY Khan', 'Rahimyar Khan'],
  Sheikhupura: ['Shekhupura'],
  Jhang: ['Jhang Sadar', 'Jhang Sadr'],
  Mingora: ['Swat'],
  'Wah Cantt': ['Wah', 'Wah Cantonment'],
  Hyderabad: ['Hyd'],
  Abbottabad: ['Abbotabad'],
  'Mirpur (Azad Kashmir)': ['Mirpur', 'Mirpur AJK', 'New Mirpur'],
  Muzaffarabad: ['Muzaffarabad AJK'],
  'Mandi Bahauddin': ['Mandi Bahaudin', 'M.B. Din', 'MB Din'],
  'Toba Tek Singh': ['T.T. Singh', 'TT Singh'],
  'Chenab Nagar': ['Rabwah'],
  Umerkot: ['Umarkot'],
  Vehari: ['Vihari'],
  Sadiqabad: ['Saddiqabad'],
  Kambar: ['Qambar'],
  Batkhela: ['Bat Khela'],
  Attock: ['Attock City', 'Campbellpur'],
  Sahiwal: ['Montgomery'],
  Khairpur: ["Khairpur Mir's", 'Khairpur Mirs'],
  Daska: ['Daska Kalan'],
  'Hasan Abdal': ['Hassan Abdal'],
  'Naushahro Feroze': ['Naushahro Firoz', 'Naushero Feroz'],
  Shahdadkot: ['Shahdad Kot'],
  'Lakki Marwat': ['Lakki'],
  Dir: ['Upper Dir'],
  Kasur: ['Qasur'],
  Taxila: ['Texila'],
  Nowshera: ['Nowshera Cantt'],
  Risalpur: ['Risalpur Cantt'],
  Hazro: ['Hazro City'],
  Gujranwala: ['Gujranwalla'],
  Peshawar: ['Pishawar'],
  Sialkot: ['Sialkot City'],
  Mardan: ['Mardaan'],
}

const PROVINCE: Record<string, string> = {
  '02': 'Balochistan',
  '03': 'Khyber Pakhtunkhwa',
  '04': 'Punjab',
  '05': 'Sindh',
  '06': 'Azad Jammu and Kashmir',
  '07': 'Gilgit-Baltistan',
  '08': 'Islamabad Capital Territory',
}
/** GeoNames district names → the common spelling. */
const DISTRICT_FIX: Record<string, string> = {
  'Rahimyar Khan': 'Rahim Yar Khan',
  Shekhupura: 'Sheikhupura',
  'Tando Mohammad Khan': 'Tando Muhammad Khan',
  'Thar Parkar': 'Tharparkar',
  Nawabshah: 'Shaheed Benazirabad',
  'Qamber Shahdadkot': 'Qambar Shahdadkot',
  Bhimbar: 'Bhimber',
  Hatian: 'Hattian Bala',
  'Naushahro Firoz': 'Naushahro Feroze',
  Vehari: 'Vehari',
}

function district(raw: string, province: string, name: string): string {
  let d = raw.replace(/ (District|Agency|Protected Area)$/, '').trim()
  d = DISTRICT_FIX[d] ?? d
  if (d) return d
  if (province === 'Islamabad Capital Territory') return 'Islamabad'
  return name
}

// ---------------------------------------------------------------- build

type Row = { id: string; name: string; lat: number; lng: number; fc: string; a1: string; district: string; pop: number }
export type Out = { name: string; province: string; district: string; lat: number; lng: number; population: number; aliases: string[]; existing: boolean }

const rows: Row[] = readFileSync(SRC, 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#') && !l.startsWith('geonameid'))
  .map((l) => {
    const p = l.split('\t')
    return { id: p[0], name: p[1], lat: Number(p[2]), lng: Number(p[3]), fc: p[4], a1: p[5], district: p[6], pop: Number(p[7]) || 0 }
  })
const byId = new Map(rows.map((r) => [r.id, r]))
for (const id of [...Object.keys(EXCLUDE), ...Object.keys(RENAME), ...Object.keys(POPULATION_FROM)]) {
  if (!byId.has(id)) throw new Error(`curation names GeoNames id ${id}, which is not in the extract`)
}

const existingIds = new Set(Object.values(EXISTING).filter((x): x is string => !!x))
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const existingByFold = new Map(Object.keys(EXISTING).map((n) => [fold(n), n]))

const out: Out[] = []
const used = new Set<string>()

// The existing 26: hand coordinates and names, a district and population for the picker.
for (const name of Object.keys(EXISTING)) {
  const id = EXISTING[name] ?? rows.find((r) => fold(RENAME[r.id] ?? r.name) === fold(name) && !EXCLUDE[r.id])?.id ?? null
  const r = id ? byId.get(id) : undefined
  if (id) used.add(id)
  const hand = HAND_CITY_COORDS[name]
  if (!hand) throw new Error(`no hand coordinates for ${name}`)
  const province = r ? PROVINCE[r.a1] : 'Punjab'
  out.push({
    name,
    province,
    district: EXISTING_DISTRICT[name] ?? (r ? district(r.district, province, name) : name),
    lat: hand.lat,
    lng: hand.lng,
    population: r?.pop ?? 0,
    aliases: [],
    existing: true,
  })
}

const fresh: (Out & { id: string })[] = []
for (const r of rows) {
  if (used.has(r.id) || existingIds.has(r.id) || EXCLUDE[r.id]) continue
  const name = RENAME[r.id] ?? r.name
  // The same name as an existing city AND the same place: it IS that city.
  const ex = existingByFold.get(fold(name))
  if (ex && HAND_CITY_COORDS[ex] && Math.abs(HAND_CITY_COORDS[ex].lat - r.lat) + Math.abs(HAND_CITY_COORDS[ex].lng - r.lng) < 0.15) {
    used.add(r.id)
    continue
  }
  const province = PROVINCE[r.a1]
  if (!province) throw new Error(`unknown province code ${r.a1} for ${r.name}`)
  const pop = POPULATION_FROM[r.id] ? Math.max(r.pop, byId.get(POPULATION_FROM[r.id])!.pop) : r.pop
  fresh.push({ id: r.id, name, province, district: district(r.district, province, name), lat: r.lat, lng: r.lng, population: pop, aliases: [], existing: false })
}

// Homonyms: the existing (or larger) place keeps the plain name; the rest show their district.
const groups = new Map<string, (Out & { id?: string })[]>()
for (const c of [...out, ...fresh]) (groups.get(fold(c.name)) ?? groups.set(fold(c.name), []).get(fold(c.name))!).push(c)
for (const list of groups.values()) {
  if (list.length < 2) continue
  list.sort((a, b) => Number(b.existing) - Number(a.existing) || b.population - a.population)
  for (const c of list.slice(1)) c.name = `${c.name} (${c.district})`
}

// Order: the big four, the other existing cities alphabetically (today's order),
// then the new places by population (GeoNames), then name.
const pinnedRank = (n: string) => (PINNED.includes(n) ? PINNED.indexOf(n) : 99)
const all: Out[] = [
  ...out.sort((a, b) => pinnedRank(a.name) - pinnedRank(b.name) || a.name.localeCompare(b.name)),
  ...fresh.sort((a, b) => b.population - a.population || a.name.localeCompare(b.name)).map(({ id: _id, ...c }) => c),
]

// Aliases; the GeoNames spelling of a renamed place is always one.
for (const c of all) {
  const extra = ALIASES[c.name] ?? []
  c.aliases = [...new Set(extra)].filter((a) => fold(a) !== fold(c.name))
}
for (const [id, name] of Object.entries(RENAME)) {
  const c = all.find((x) => x.name === name)
  const gn = byId.get(id)!.name
  if (c && fold(gn) !== fold(c.name) && !c.aliases.some((a) => fold(a) === fold(gn))) c.aliases.push(gn)
}
for (const name of Object.keys(ALIASES)) if (!all.some((c) => c.name === name)) throw new Error(`alias list names ${name}, which is not a city`)

// Checks: unique names and URL slugs; no alias is another city's name.
const names = new Set<string>()
const slugs = new Set<string>()
const nameFolds = new Set(all.map((c) => fold(c.name)))
for (const c of all) {
  if (names.has(fold(c.name))) throw new Error(`duplicate name ${c.name}`)
  names.add(fold(c.name))
  const s = slugify(c.name)
  if (!s || slugs.has(s)) throw new Error(`duplicate slug ${s}`)
  slugs.add(s)
  for (const a of c.aliases) if (nameFolds.has(fold(a)) && fold(a) !== fold(c.name)) throw new Error(`alias ${a} of ${c.name} is another city's name`)
}
if (all.filter((c) => c.existing).length !== 26) throw new Error('expected the existing 26')

// ---------------------------------------------------------------- write

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const ts = [
  '// lib/pkCityData.ts — GENERATED by scripts/build-pk-cities.ts. Do not edit by hand.',
  '//',
  '// Every city and town on the city list (owner, 20 Oct 2026): the existing 26 first',
  '// (unchanged: their coordinates are the hand values), then every other Pakistani',
  '// town from GeoNames (https://www.geonames.org, CC BY 4.0) by population.',
  '// Province, district, coordinates, population and aliases live here; the',
  '// database row is the name alone, as it always was (location_cities).',
  '',
  'export type PkCity = {',
  '  name: string',
  '  province: string',
  '  district: string',
  '  lat: number',
  '  lng: number',
  '  /** GeoNames population (0 = not recorded); used only to order the picker. */',
  '  population: number',
  '  aliases: string[]',
  '  /** One of the 26 cities on the list before 20 Oct 2026. */',
  '  existing: boolean',
  '}',
  '',
  'export const PK_CITIES: PkCity[] = [',
  ...all.map((c) => `  ${JSON.stringify(c)},`),
  ']',
  '',
].join('\n')
writeFileSync(OUT_TS, ts)

const newOnes = all.filter((c) => !c.existing)
const counts = new Map<string, number>()
for (const c of newOnes) counts.set(c.province, (counts.get(c.province) ?? 0) + 1)
const sql = [
  '-- 188_all_pk_cities.sql — GENERATED by scripts/build-pk-cities.ts (owner, 20 Oct 2026).',
  '--',
  '-- Every Pakistani city and town on the city list. Source: GeoNames (CC BY 4.0),',
  '-- extract and curation in supabase/seed/pk-cities-geonames.tsv and the generator.',
  '-- Each new city is stored exactly like the existing 26: its name and sort_order',
  '-- 100 (province, district and coordinates are in lib/pkCityData.ts, as the',
  '-- existing ones are in code). Existing rows are never changed: on conflict do',
  '-- nothing, so the migration can be re-run safely. Search aliases go into',
  "-- taxonomy_aliases (kind 'city', slug = the city's name), the existing mechanism.",
  `-- New cities: ${newOnes.length} (${[...counts.entries()].map(([p, n]) => `${p} ${n}`).join(', ')}).`,
  '',
  'insert into public.location_cities (name, sort_order) values',
  newOnes.map((c) => `  (${q(c.name)}, 100)`).join(',\n'),
  'on conflict (name) do nothing;',
  '',
  'insert into public.taxonomy_aliases (kind, slug, alias) values',
  all.flatMap((c) => c.aliases.map((a) => `  ('city', ${q(c.name)}, ${q(a.toLowerCase())})`)).join(',\n'),
  'on conflict (kind, slug, alias) do nothing;',
  '',
].join('\n')
writeFileSync(OUT_SQL, sql)

console.log(`${all.length} cities (${newOnes.length} new). By province:`)
for (const [p, n] of [...counts.entries()].sort()) console.log(`  ${p}: ${n}`)
console.log('Excluded:')
for (const r of Object.values(EXCLUDE)) console.log(`  ${r}`)
console.log('Shown with a district:', all.filter((c) => /\(/.test(c.name)).map((c) => c.name).join(', '))
