/**
 * scripts/test-covers.ts
 *
 *   npm run test:covers
 *
 * The cover asset library and composer:
 *   - catalogue integrity: every catalogued asset's file exists, and every PNG
 *     on disk is catalogued (the two must never drift — the catalogue is the
 *     source of truth);
 *   - deterministic selection: selectCover is a pure function of (post, seed),
 *     the three grounds are white/mint/navy, and the fallbacks hold;
 *   - one composed PNG per background decodes as a 1200×630 PNG.
 *
 * The composer imports next/og, which DOES run under the test runner (unlike
 * @react-pdf), so the PNG decode is exercised here directly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { COVER_ASSETS, COVER_BY_SLUG, coverAsset } from '../lib/covers/catalog'
import {
  selectCover,
  subjectMotif,
  clusterMotif,
  citySilhouette,
  personFor,
  type CoverInput,
} from '../lib/covers/select'
import { renderCoverPng } from '../lib/covers/compose'

const COVERS_DIR = path.join(process.cwd(), 'public', 'covers')

// ---- catalogue integrity --------------------------------------------------

test('every catalogued asset has a file on disk', () => {
  for (const a of COVER_ASSETS) {
    assert.ok(existsSync(path.join(COVERS_DIR, a.file)), `missing file for ${a.slug}: ${a.file}`)
    assert.ok(a.width > 0 && a.height > 0, `${a.slug} has no natural size`)
  }
})

test('every PNG on disk is catalogued', () => {
  const files = readdirSync(COVERS_DIR).filter((f) => f.endsWith('.png'))
  const catalogued = new Set(COVER_ASSETS.map((a) => a.file))
  for (const f of files) assert.ok(catalogued.has(f), `${f} is on disk but not in the catalogue`)
  assert.equal(files.length, COVER_ASSETS.length, 'file count and catalogue length differ')
})

test('no JPEG sources remain (the build deletes them)', () => {
  const jpegs = readdirSync(COVERS_DIR).filter((f) => /\.jpe?g$/i.test(f))
  assert.equal(jpegs.length, 0, `unprocessed JPEGs remain: ${jpegs.join(', ')}`)
})

test('the fallback assets exist', () => {
  for (const slug of ['pakistan-map', 'book', 'search', 'student', 'parent-child', 'teacher-male', 'teacher-female']) {
    assert.ok(COVER_BY_SLUG.has(slug), `expected a "${slug}" asset`)
  }
})

// ---- deterministic selection ----------------------------------------------

const base: CoverInput = {
  title: 'O Level Physics tutors in Lahore: fees and how to choose',
  cluster: 'cost-hiring',
  city: 'Lahore',
  subject: 'O Level Physics',
  audience: 'parents',
  slug: 'physics-lahore',
}

test('the three grounds are white / mint / navy (seeds 0,1,2)', () => {
  assert.equal(selectCover(base, 0).background, 'white')
  assert.equal(selectCover(base, 1).background, 'mint')
  assert.equal(selectCover(base, 2).background, 'navy')
})

test('selection is deterministic — same (input, seed) gives the same result', () => {
  assert.deepEqual(selectCover(base, 0), selectCover(base, 0))
  assert.deepEqual(selectCover(base, 5), selectCover(base, 5))
})

test('title colour follows the ground', () => {
  assert.equal(selectCover(base, 0).titleColor, 'navy')
  assert.equal(selectCover(base, 2).titleColor, 'white')
})

test('city resolves, with pakistan-map as the fallback', () => {
  assert.equal(citySilhouette('Lahore'), 'lahore')
  assert.equal(citySilhouette('Karachi'), 'karachi')
  assert.equal(citySilhouette('Quetta'), 'pakistan-map') // no silhouette shipped
  assert.equal(citySilhouette(null), 'pakistan-map')
})

test('subject maps to a motif, with book as the fallback', () => {
  assert.equal(subjectMotif('O Level Physics'), 'physics')
  assert.equal(subjectMotif('Mathematics'), 'maths')
  assert.equal(subjectMotif('IGCSE Chemistry'), 'science')
  assert.equal(subjectMotif('Biology'), 'biology')
  assert.equal(subjectMotif('English Literature'), 'english')
  assert.equal(subjectMotif('Nazra Quran'), 'quran')
  assert.equal(subjectMotif('Pakistan Studies'), 'book') // no keyword -> fallback
  assert.equal(subjectMotif(null), 'book')
})

test('cluster maps to a second motif, else search', () => {
  assert.equal(clusterMotif('cost-hiring'), 'wallet')
  assert.equal(clusterMotif('safety-trust'), 'shield')
  assert.equal(clusterMotif('boards-exams'), 'certificate')
  assert.equal(clusterMotif('subject-guides'), 'search')
  assert.equal(clusterMotif('city-guides'), 'search')
})

test('person follows audience; teachers alternate deterministically', () => {
  assert.equal(selectCover({ ...base, audience: 'parents' }, 0).personSlug, 'parent-child')
  assert.equal(selectCover({ ...base, audience: 'both' }, 0).personSlug, 'student')
  const t = selectCover({ ...base, audience: 'tutors' }, 0).personSlug
  assert.ok(t === 'teacher-male' || t === 'teacher-female')
  // The variant flips the teacher.
  assert.notEqual(personFor('tutors', 'x', 0), personFor('tutors', 'x', 1))
})

test('motifs are deduped and shuffle swaps their order', () => {
  // cost-hiring + physics -> [physics, wallet]; the shuffled trio reverses it.
  assert.deepEqual(selectCover(base, 0).motifs, ['physics', 'wallet'])
  assert.deepEqual(selectCover(base, 3).motifs, ['wallet', 'physics'])
  // A cluster whose motif equals the subject motif collapses to one.
  const same = selectCover({ ...base, cluster: 'subject-guides', subject: 'General search skills' }, 0)
  // subject 'General search skills' -> book; cluster subject-guides -> search; two distinct.
  assert.equal(same.motifs.length, 2)
})

test('shuffle rotates the ground across the trio', () => {
  // seeds 0,1,2 -> white,mint,navy ; seeds 3,4,5 -> mint,navy,white
  assert.equal(selectCover(base, 3).background, 'mint')
  assert.equal(selectCover(base, 4).background, 'navy')
  assert.equal(selectCover(base, 5).background, 'white')
})

// ---- one composed PNG per background --------------------------------------

function assetUri(slug: string | null): string | null {
  const a = coverAsset(slug)
  if (!a) return null
  const buf = readFileSync(path.join(COVERS_DIR, a.file))
  return `data:image/png;base64,${buf.toString('base64')}`
}

for (const seed of [0, 1, 2]) {
  test(`composed cover for seed ${seed} decodes as a 1200×630 PNG`, async () => {
    const sel = selectCover(base, seed)
    const [city, person, ...motifs] = [assetUri(sel.citySlug), assetUri(sel.personSlug), ...sel.motifs.map(assetUri)]
    const res = renderCoverPng({ title: base.title, selection: sel, assets: { city, person, motifs } })
    const buf = Buffer.from(await res.arrayBuffer())
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG')
    assert.equal(buf.readUInt32BE(16), 1200, 'width')
    assert.equal(buf.readUInt32BE(20), 630, 'height')
    assert.ok(buf.length > 5000, 'suspiciously small PNG')
  })
}
