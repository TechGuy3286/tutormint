// scripts/covers-build.ts
//
//   npx tsx scripts/covers-build.ts
//
// The one-time (idempotent) processor for the blog cover ASSET LIBRARY.
//
// public/covers/ ships with owner-made 2K JPEG illustrations whose filenames are
// long and generated. This script turns each into a small, transparent PNG the
// cover composer can layer: it maps each source file to a short content slug,
// keys pure white to transparent (a soft threshold so edges are not jagged),
// trims the margins, downscales to a sensible ceiling for its kind, writes
// public/covers/<slug>.png, and deletes the source JPEG. It then writes
// lib/covers/catalog.ts from what is actually on disk, so the catalogue is never
// out of step with the files (scripts/test-covers.ts asserts that both ways).
//
// NO EXTERNAL IMAGE API is involved anywhere in the cover feature — the library
// here is the whole source of imagery, and the composer draws only from it.
//
// Re-runnable: if the JPEGs are already gone it simply rebuilds the catalogue
// from the PNGs on disk, so a later `npm run build:covers` cannot desync them.

import { readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const COVERS_DIR = path.join(process.cwd(), 'public', 'covers')
const CATALOG_PATH = path.join(process.cwd(), 'lib', 'covers', 'catalog.ts')

type Kind = 'city' | 'person' | 'motif'

// The map from a distinctive token in the source filename to the slug, kind and
// tags. Tokens are matched case-insensitively as substrings, most-specific
// first, so "displaying" (the online laptop) is decided before a bare "laptop".
// Every entry names ONE source file; the whole set is validated to be a
// bijection with the JPEGs on disk before anything is written.
type Rule = { token: string; slug: string; kind: Kind; tags: string[] }
const RULES: Rule[] = [
  // Cities — one silhouette each; pakistan-map is the fallback in the composer.
  { token: 'Lahore_skyline', slug: 'lahore', kind: 'city', tags: ['lahore'] },
  { token: 'Karachi_skyline', slug: 'karachi', kind: 'city', tags: ['karachi'] },
  { token: 'Faisal_Mosque', slug: 'islamabad', kind: 'city', tags: ['islamabad'] },
  { token: 'Rawalpindi_skyline', slug: 'rawalpindi', kind: 'city', tags: ['rawalpindi'] },
  { token: 'Clock_Tower', slug: 'faisalabad', kind: 'city', tags: ['faisalabad'] },
  { token: 'Shrine_skyline', slug: 'multan', kind: 'city', tags: ['multan'] },
  { token: 'Peshawar_skyline', slug: 'peshawar', kind: 'city', tags: ['peshawar'] },
  { token: 'Pakistan_map', slug: 'pakistan-map', kind: 'city', tags: ['pakistan'] },

  // People — one per audience the composer picks by.
  { token: 'Mother_holding_child', slug: 'parent-child', kind: 'person', tags: ['parents'] },
  { token: 'Student_writing', slug: 'student', kind: 'person', tags: ['both', 'student'] },
  // Two teachers, one slug each; the composer alternates by a slug hash. The
  // male/female assignment is arbitrary — the source art is not gendered — and
  // is recorded here so it is a decision, not an accident.
  { token: 'Teacher_holding_open', slug: 'teacher-female', kind: 'person', tags: ['tutors'] },
  { token: 'Teacher_holding_tablet', slug: 'teacher-male', kind: 'person', tags: ['tutors'] },

  // Motifs — subjects and clusters.
  { token: 'search_bar', slug: 'search', kind: 'motif', tags: ['search', 'city-guides'] },
  { token: 'Open_book_with_bookmark', slug: 'book', kind: 'motif', tags: ['subject-guides', 'reading'] },
  { token: 'Graduation_cap', slug: 'grad-cap', kind: 'motif', tags: ['tutor-career', 'results'] },
  { token: 'location_pin', slug: 'pin', kind: 'motif', tags: ['city-guides', 'area'] },
  { token: 'speech_bubbles', slug: 'chat', kind: 'motif', tags: ['messaging', 'safety-trust'] },
  { token: 'Mint_green_star', slug: 'star', kind: 'motif', tags: ['rating', 'reviews'] },
  { token: 'Drafting_tools', slug: 'maths', kind: 'motif', tags: ['maths', 'mathematics'] },
  { token: 'Flask_and_test_tube', slug: 'science', kind: 'motif', tags: ['science', 'chemistry'] },
  { token: 'Stylized_atom', slug: 'physics', kind: 'motif', tags: ['physics'] },
  { token: 'DNA_double_helix', slug: 'biology', kind: 'motif', tags: ['biology'] },
  { token: 'Fountain_pen', slug: 'english', kind: 'motif', tags: ['english', 'writing'] },
  { token: 'Open_laptop', slug: 'computer', kind: 'motif', tags: ['computer', 'computer science'] },
  // A book on a folding stand is a Quran rehal.
  { token: 'folding_stand', slug: 'quran', kind: 'motif', tags: ['quran', 'holy quran'] },
  { token: 'displaying_teacher_video', slug: 'online', kind: 'motif', tags: ['online', 'online tutoring'] },
  { token: 'House_vector', slug: 'home', kind: 'motif', tags: ['home', 'home tutoring'] },
  { token: 'Wallet_with_banknotes', slug: 'wallet', kind: 'motif', tags: ['cost-hiring', 'fees'] },
  { token: 'shield_shape', slug: 'shield', kind: 'motif', tags: ['safety-trust', 'verification'] },
  { token: 'Diploma_scroll', slug: 'certificate', kind: 'motif', tags: ['boards-exams', 'results'] },
  { token: 'Calendar_page', slug: 'calendar', kind: 'motif', tags: ['schedules', 'boards-exams'] },
  { token: 'Smartphone', slug: 'phone', kind: 'motif', tags: ['contact', 'phone'] },
  { token: 'School_building', slug: 'school', kind: 'motif', tags: ['schools', 'admissions'] },
]

// The downscale ceiling per kind (longest relevant side, never enlarged).
type ResizeSpec = { width?: number; height?: number; fit?: 'inside'; withoutEnlargement?: boolean }
function resizeFor(kind: Kind): ResizeSpec {
  if (kind === 'city') return { width: 1600, withoutEnlargement: true }
  if (kind === 'person') return { height: 1200, withoutEnlargement: true }
  return { width: 800, height: 800, fit: 'inside', withoutEnlargement: true }
}

/**
 * Key near-white pixels to transparent with a soft ramp, so the illustration
 * sits on any background without a white box around it and without a hard
 * jagged edge. The ramp runs over min-channel 225..245: fully opaque at 225 and
 * below, fully transparent at 245 and above.
 */
async function keyWhite(inputPath: string): Promise<ReturnType<typeof sharp>> {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const out = Buffer.from(data)
  const LO = 225
  const HI = 245
  for (let i = 0; i < out.length; i += ch) {
    const m = Math.min(out[i], out[i + 1], out[i + 2])
    let a: number
    if (m >= HI) a = 0
    else if (m <= LO) a = 255
    else a = Math.round((255 * (HI - m)) / (HI - LO))
    out[i + 3] = a
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } })
}

function slugForFile(file: string): Rule | null {
  const lower = file.toLowerCase()
  return RULES.find((r) => lower.includes(r.token.toLowerCase())) ?? null
}

async function main() {
  if (!existsSync(COVERS_DIR)) throw new Error(`missing ${COVERS_DIR}`)
  const files = readdirSync(COVERS_DIR)
  const jpegs = files.filter((f) => /\.jpe?g$/i.test(f))

  if (jpegs.length > 0) {
    // Validate the mapping is a clean bijection BEFORE writing anything.
    const usedSlugs = new Map<string, string>()
    const usedRules = new Set<string>()
    for (const f of jpegs) {
      const rule = slugForFile(f)
      if (!rule) throw new Error(`no slug rule matches "${f}" — add a token to RULES`)
      if (usedRules.has(rule.slug)) throw new Error(`rule "${rule.slug}" matched two files (last: ${f})`)
      usedRules.add(rule.slug)
      if (usedSlugs.has(rule.slug)) throw new Error(`slug "${rule.slug}" already used by ${usedSlugs.get(rule.slug)}`)
      usedSlugs.set(rule.slug, f)
    }
    for (const rule of RULES) {
      if (!usedSlugs.has(rule.slug)) throw new Error(`RULES has "${rule.slug}" but no source JPEG matched its token "${rule.token}"`)
    }

    for (const f of jpegs) {
      const rule = slugForFile(f)!
      const inPath = path.join(COVERS_DIR, f)
      const outPath = path.join(COVERS_DIR, `${rule.slug}.png`)
      const keyed = await keyWhite(inPath)
      await keyed
        .trim({ threshold: 12 })
        .resize(resizeFor(rule.kind))
        .png({ compressionLevel: 9 })
        .toFile(outPath)
      rmSync(inPath)
      const meta = await sharp(outPath).metadata()
      console.log(`  ${f}\n    -> ${rule.slug}.png  ${meta.width}x${meta.height} (${rule.kind})`)
    }
  } else {
    console.log('No JPEGs to process — rebuilding the catalogue from the PNGs on disk.')
  }

  // Rebuild the catalogue from the PNGs actually present.
  const entries: { slug: string; kind: Kind; file: string; tags: string[]; width: number; height: number }[] = []
  for (const rule of RULES) {
    const file = `${rule.slug}.png`
    const p = path.join(COVERS_DIR, file)
    if (!existsSync(p)) throw new Error(`expected ${file} on disk but it is missing — re-run with the JPEGs present`)
    const meta = await sharp(p).metadata()
    entries.push({ slug: rule.slug, kind: rule.kind, file, tags: rule.tags, width: meta.width ?? 0, height: meta.height ?? 0 })
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.slug.localeCompare(b.slug) : a.kind.localeCompare(b.kind)))

  const body = entries
    .map(
      (e) =>
        `  { slug: ${JSON.stringify(e.slug)}, kind: ${JSON.stringify(e.kind)}, file: ${JSON.stringify(e.file)}, tags: ${JSON.stringify(e.tags)}, width: ${e.width}, height: ${e.height} },`,
    )
    .join('\n')

  const out = `// lib/covers/catalog.ts
//
// GENERATED by scripts/covers-build.ts from public/covers/*.png — do not edit by
// hand. It is the SOURCE OF TRUTH for the cover asset library: every entry's
// file exists and every file is catalogued (scripts/test-covers.ts asserts
// both). The images are white-keyed transparent PNGs; there is no external image
// API anywhere in the cover feature.

export type CoverKind = 'city' | 'person' | 'motif'

export type CoverAsset = {
  slug: string
  kind: CoverKind
  /** File under public/covers/, served at /covers/<file>. */
  file: string
  /** Cities / subjects / clusters / audiences the asset suits. */
  tags: string[]
  /** Natural pixel size after processing. */
  width: number
  height: number
}

export const COVER_ASSETS: CoverAsset[] = [
${body}
]

export const COVER_BY_SLUG: Map<string, CoverAsset> = new Map(COVER_ASSETS.map((a) => [a.slug, a]))

export function coverAsset(slug: string | null | undefined): CoverAsset | null {
  return slug ? COVER_BY_SLUG.get(slug) ?? null : null
}
`
  writeFileSync(CATALOG_PATH, out)
  console.log(`\nWrote ${CATALOG_PATH} with ${entries.length} assets.`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('covers-build failed:', e)
    process.exit(1)
  },
)
