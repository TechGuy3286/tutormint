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

test('person is audience-appropriate and rotates on every shuffle (PR16 §6.5)', () => {
  // Every audience draws from its own pool; the person is always one of them.
  assert.ok(['parent-child', 'student'].includes(personFor('parents', 'x', 0)))
  assert.ok(['student', 'teacher-female', 'teacher-male', 'parent-child'].includes(personFor('both', 'x', 0)))
  assert.ok(['teacher-female', 'teacher-male', 'student'].includes(personFor('tutors', 'x', 0)))
  // The roll rotates the person deterministically — consecutive shuffles differ.
  assert.notEqual(personFor('tutors', 'x', 0), personFor('tutors', 'x', 1))
  assert.notEqual(personFor('both', 'x', 0), personFor('both', 'x', 1))
  assert.notEqual(personFor('parents', 'x', 0), personFor('parents', 'x', 1))
  // Deterministic per (seed, roll).
  assert.equal(personFor('both', 'x', 5), personFor('both', 'x', 5))
})

test('motifs are deduped; shuffle rotates the second motif to a new one (§2.1)', () => {
  // cost-hiring + physics -> subject motif 'physics' + cluster motif 'wallet'.
  assert.deepEqual(selectCover(base, 0).motifs, ['physics', 'wallet'])
  // The next Shuffle (roll 1) draws a DIFFERENT second motif from the pool, so
  // the trio is genuinely new rather than the same two re-ordered.
  const shuffled = selectCover(base, 3).motifs
  assert.notDeepEqual(selectCover(base, 0).motifs, shuffled)
  assert.equal(shuffled[0], 'physics') // subject motif stays
  assert.notEqual(shuffled[1], 'wallet') // second motif changed
  assert.ok(!shuffled.slice(1).includes('physics')) // subject motif never drawn twice
  // A cluster whose motif equals the subject motif still yields two distinct.
  const same = selectCover({ ...base, cluster: 'subject-guides', subject: 'General search skills' }, 0)
  assert.equal(same.motifs.length, 2)
})

test('shuffle never repeats the previous trio (§2.1)', () => {
  const trio = (roll: number) => [0, 1, 2].map((i) => JSON.stringify(selectCover(base, roll * 3 + i)))
  const t0 = trio(0)
  const t1 = trio(1)
  const t2 = trio(2)
  assert.notDeepEqual(t0, t1)
  assert.notDeepEqual(t1, t2)
  assert.notDeepEqual(t0, t2)
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

// ── PR38 — cover image prompt (pure, no image service) ──
import { coverImagePrompt } from '../lib/covers/prompt'

import { COLOUR_NAMES, PROMPT_COLOURS, PROMPT_COMPOSITION, PROMPT_DO_NOT, PROMPT_STYLE, hasHexCode } from '../lib/covers/prompt'
import { BRAND } from '../lib/brand'

// Every post shape the blog has, including the raw database labels a Subject
// field can carry, and every cluster.
const PROMPT_POSTS: Parameters<typeof coverImagePrompt>[0][] = [
  { title: 'Grade 9 & 10 - Science English tutors in Lahore: fees and how to choose', cluster: 'cost-hiring', city: 'Lahore', subject: 'Grade 9 & 10 - Science English', audience: 'parents', slug: 'a' },
  { title: 'How to find a good Primary Islamiat tutor in Lahore', cluster: 'subject-guides', city: 'Lahore', subject: 'Primary Islamiat', audience: 'parents', slug: 'b' },
  { title: 'How to become a home tutor in Pakistan: a step-by-step start', cluster: 'tutor-career', audience: 'tutors', slug: 'c' },
  { title: 'FA Maths tutors', cluster: 'cost-hiring', city: 'Karachi', subject: 'FA ( Part I & Part II) Mathematics', audience: 'parents', slug: 'd' },
  { title: 'BS tutors', cluster: 'subject-guides', city: 'Islamabad', subject: 'Semester 1 - 8 Computer Science', audience: 'both', slug: 'e' },
  { title: 'O and A Level October–November exam prep, 2026', cluster: 'boards-exams', audience: 'both', slug: 'f' },
  { title: 'Finding a tutor in Multan', cluster: 'city-guides', city: 'Multan', audience: 'parents', slug: 'g' },
  { title: 'Keeping messages useful: how TutorMint handles spam', cluster: 'safety-trust', audience: 'both', slug: 'h' },
  { title: 'Online O Level Physics tutoring', cluster: 'subject-guides', subject: 'O Level Physics', audience: 'both', slug: 'i' },
  { title: 'Play Group English', cluster: 'subject-guides', subject: 'Pre Nursery / Play Group / KG I English', audience: 'parents', slug: 'j' },
]

test('the cover prompt has the fixed style, colours, composition and "do not" lines', () => {
  assert.equal(PROMPT_STYLE, 'Flat vector illustration, 1200×630 landscape, clean and friendly, soft daylight.')
  // The colours are the site theme's own values (lib/brand mirrors app/globals.css).
  // The colours are the site theme's own, by NAME — never a hex code, which an
  // image model can paint onto the picture as text (owner, 14 Oct 2026).
  assert.equal(PROMPT_COLOURS, 'Colours: dark navy blue, fresh mint green, deep red accents and near black, on a very light off-white background.')
  for (const hex of [BRAND.navy, BRAND.mint, BRAND.red, BRAND.black, BRAND.bg]) {
    assert.ok(COLOUR_NAMES[hex], `the theme colour ${hex} has a name`)
    assert.ok(!PROMPT_COLOURS.includes(hex), hex)
  }
  for (const p of PROMPT_POSTS) assert.ok(!hasHexCode(coverImagePrompt(p)), p.title)
  assert.ok(PROMPT_COMPOSITION.includes('left 45% plain and uncluttered'))
  for (const p of PROMPT_POSTS) {
    const text = coverImagePrompt(p)
    for (const part of [PROMPT_STYLE, PROMPT_COLOURS, PROMPT_COMPOSITION, PROMPT_DO_NOT]) assert.ok(text.includes(part), `${p.title}: ${part}`)
    assert.ok(text.endsWith(PROMPT_DO_NOT), 'the "do not" line ends the prompt')
    assert.ok(text.includes('everyday Pakistani clothing') && text.includes('age-appropriate'))
    assert.ok(!text.includes('\n'), 'one paragraph')
    const words = text.split(/\s+/).length
    assert.ok(words <= 125, `${p.title}: ${words} words`)
  }
  for (const part of ['no text', 'no letters', 'no numbers', 'no logos', 'no signage', 'no watermarks', 'no school crests or uniforms with badges', 'no real or famous people', 'no distorted hands or faces']) {
    assert.ok(PROMPT_DO_NOT.toLowerCase().replace(/^do not include: /, 'no ').replace(/, /g, ', no ').includes(part), part)
  }
})

test('the cover prompt never carries a raw label, a cluster name, a claim or a brand name', () => {
  const RAW = [/grade\s*9\s*&\s*10/i, /\(\s*part/i, /semester/i, /pre nursery \/ play group/i, /\s-\s/, /\bscience english\b/i]
  const CLUSTERS = ['Cost & hiring', 'Boards & exams', 'Subject guides', 'City guides', 'Tutor career', 'Safety & trust', 'cost-hiring', 'subject-guides', 'tutor-career', 'city-guides', 'boards-exams', 'safety-trust']
  for (const p of PROMPT_POSTS) {
    const text = coverImagePrompt({ ...p, clusterLabel: 'Cost & hiring' })
    for (const re of RAW) assert.ok(!re.test(text), `${p.title}: raw label ${re}`)
    for (const c of CLUSTERS) assert.ok(!text.includes(c), `${p.title}: cluster ${c}`)
    assert.ok(!/largest|biggest|\bbest\b|#1\b|no\.?\s*1\b|most trusted/i.test(text), `${p.title}: claim`)
    assert.ok(!/tutor\s?mint|jazzcash|easypaisa|paypro|beaconhouse|whatsapp|zoom/i.test(text), `${p.title}: brand name`)
    // The post title (which carries raw labels) is never pasted in.
    assert.ok(!text.includes(p.title), `${p.title}: title pasted`)
  }
})

test('the scene uses plain lesson names and fits the post', () => {
  const s = (i: number) => coverImagePrompt(PROMPT_POSTS[i])
  assert.match(s(0), /It is a Matric English lesson./)
  assert.match(s(0), /reading an English book together at a home study table/)
  assert.match(s(1), /studying the Quran together at a home study table/)
  assert.match(s(1), /It is a Primary Islamiat lesson./)
  assert.match(s(2), /tutor alone at a home desk, preparing a lesson/)
  assert.match(s(3), /It is an FA Maths lesson./)
  assert.match(s(3), /maths problem in a notebook/)
  assert.match(s(4), /It is a BS Computer Science lesson./)
  assert.match(s(5), /It is an O and A Level lesson./)
  assert.match(s(6), /calm street in Multan/)
  assert.match(s(8), /video lesson on a laptop/)
  assert.match(s(9), /It is a Play Group and KG English lesson./)
  // Religious items only for a religious topic.
  assert.ok(!s(1).includes('no religious items'))
  for (const i of [0, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.ok(s(i).includes('no religious items'), String(i))
    assert.ok(!/quran|mosque|prayer/i.test(s(i)), String(i))
  }
  // A parent appears for a parents' post about a young child.
  assert.match(s(9), /a parent sitting nearby/)
  assert.ok(!s(3).includes('parent'))
})

// ── 14 Oct 2026 — one fixed layout, a scene with no text, compressed output ──
import type { ReactElement, ReactNode } from 'react'
import sharp from 'sharp'
import { COVER_LAYOUT, CoverTextError, overlayLayer, sceneLayer, titleSize } from '../lib/covers/compose'
import { coverJpeg, COVER_MAX_BYTES } from '../lib/covers/encode'
import { sceneFor } from '../lib/covers/scene'
import { coverAltText } from '../lib/covers/select'
import { brandLine } from '../lib/brandClaims'

/** Every piece of text in an element tree (intrinsic elements only). */
function textIn(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textIn)
  const el = node as ReactElement<{ children?: ReactNode }>
  assert.equal(typeof el.type, 'string', 'the layers are plain elements, so every text node can be found')
  return textIn(el.props?.children)
}

const post = (over: Partial<CoverInput>): CoverInput => ({ title: 'A guide', cluster: 'subject-guides', city: null, subject: null, audience: 'parents', slug: 'a-guide', ...over })

test('the scene follows the post: subject, level, city and cluster', () => {
  assert.equal(sceneFor(post({ subject: 'Primary Islamiat' })).kind, 'quran')
  assert.equal(sceneFor(post({ subject: 'Nazra Quran' })).kind, 'quran')
  assert.equal(sceneFor(post({ subject: 'O Level Physics' })).kind, 'experiment')
  assert.equal(sceneFor(post({ subject: 'General Science' })).kind, 'experiment')
  assert.equal(sceneFor(post({ subject: 'Grade 5 Maths' })).kind, 'maths')
  assert.equal(sceneFor(post({ subject: 'English' })).kind, 'reading')
  assert.equal(sceneFor(post({ subject: 'Urdu' })).kind, 'reading')
  assert.equal(sceneFor(post({ cluster: 'tutor-career', title: 'How to become a home tutor' })).kind, 'tutor-prep')
  assert.equal(sceneFor(post({ cluster: 'city-guides', city: 'Lahore', title: 'Finding a tutor in Lahore' })).kind, 'city')
  assert.equal(sceneFor(post({ title: 'Online tutoring: what parents should check' })).kind, 'online')
  assert.equal(sceneFor(post({ cluster: 'boards-exams', title: 'O and A Level October–November exam prep, 2026' })).kind, 'exam')
  // Religious detail only when the topic itself is religious.
  assert.equal(sceneFor(post({ subject: 'Primary Islamiat' })).religious, true)
  for (const s of ['O Level Physics', 'Grade 5 Maths', 'English']) assert.equal(sceneFor(post({ subject: s })).religious, false, s)
  // The student's age follows the level.
  assert.match(sceneFor(post({ subject: 'Primary Islamiat' })).student, /eight/)
  assert.match(sceneFor(post({ subject: 'O Level Physics' })).student, /sixteen/)
  // Women and men tutors both appear across posts.
  const tutors = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => sceneFor(post({ slug })).tutor))
  assert.deepEqual([...tutors].sort(), ['female', 'male'])
  // The library picture follows the scene.
  assert.equal(selectCover(post({ title: 'Online tutoring: what parents should check' }), 0).motifs.includes('online'), true)
  assert.ok(['teacher-female', 'teacher-male'].includes(selectCover(post({ cluster: 'tutor-career', audience: 'tutors' }), 0).personSlug))
  assert.notEqual(selectCover(post({ cluster: 'tutor-career' }), 0).personSlug, selectCover(post({ cluster: 'tutor-career' }), 3).personSlug)
  // Age-appropriate: an O / A Level cover never shows a parent leading a small child.
  for (let seed = 0; seed < 12; seed++) {
    assert.notEqual(selectCover(post({ cluster: 'boards-exams', audience: 'both', title: 'O and A Level exam prep' }), seed).personSlug, 'parent-child')
  }
})

test('text is ONLY in the overlay layer; the scene layer has none', () => {
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    const sel = selectCover(base, seed)
    const scene = sceneLayer(sel, { city: 'data:image/png;base64,AA', person: 'data:image/png;base64,AA', motifs: ['data:image/png;base64,AA', 'data:image/png;base64,AA'] })
    assert.deepEqual(textIn(scene), [], `seed ${seed}: the scene must not contain text`)
  }
  const line = brandLine(6)
  // The monogram is a picture; the wordmark beside it, the title, the brand
  // line, the tagline and the site address are typed.
  const withMark = textIn(overlayLayer({ title: base.title, brandLine: line, tagline: 'Free to join. No commission. No middleman.', monogram: 'data:image/png;base64,AA' }))
  assert.deepEqual(withMark, ['Tutor', 'Mint', base.title, line, 'Free to join. No commission. No middleman.', 'tutormint.org'])
  // Without the monogram the same words are typed, in the same order.
  assert.deepEqual(textIn(overlayLayer({ title: base.title, brandLine: line, tagline: 'Free to join. No commission. No middleman.', monogram: null })), withMark)
})

test('one fixed layout: logo corner, safe margins, title sized to three lines', () => {
  assert.equal(COVER_LAYOUT.titleMaxLines, 3)
  // The text column ends before the scene starts, with a margin on both sides.
  assert.ok(COVER_LAYOUT.margin >= 48)
  assert.ok(COVER_LAYOUT.margin + COVER_LAYOUT.textWidth + COVER_LAYOUT.margin / 2 <= COVER_LAYOUT.sceneLeft)
  assert.equal(COVER_LAYOUT.sceneLeft + COVER_LAYOUT.sceneWidth, 1200)
  // A longer title is set smaller, never larger.
  const sizes = ['Short title', 'x'.repeat(40), 'x'.repeat(70), 'x'.repeat(120)].map(titleSize)
  assert.deepEqual([...sizes].sort((a, b) => b - a), sizes)
  // The overlay does not depend on the option: it takes no selection at all.
  assert.equal(overlayLayer.length, 1)
  // The clean logo files exist; the old ones are kept.
  for (const f of ['brand/tutormint-logo.png', 'brand/tutormint-logo-dark.png', 'brand/tutormint-logo-640.png', 'brand/tutormint-monogram.png', 'logo.png', 'TutorMint-Footer-Logo-2448x752.png', 'tutormint-logo-1080x1080.png']) {
    assert.ok(existsSync(path.join(process.cwd(), 'public', f)), f)
  }
})

test('a generated overlay with a banned word is refused; the tagline is the site one', () => {
  const sel = selectCover(base, 0)
  const assets = { city: null, person: null, motifs: [] }
  for (const bad of ["Pakistan's largest tutor network", 'The best tutors in Lahore', 'No.1 tutors', 'Most trusted tutors']) {
    assert.throws(() => renderCoverPng({ title: bad, selection: sel, assets }), CoverTextError, bad)
  }
  assert.throws(() => renderCoverPng({ title: 'Fine', selection: sel, assets, brandLine: 'The leading tutor network' }), CoverTextError)
  assert.ok(readFileSync(path.join(process.cwd(), 'lib', 'covers', 'compose.tsx'), 'utf8').includes('tagline = SITE_TAGLINE'))
  // The upload guard is still in place.
  const upload = readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'blog', 'cover', 'route.ts'), 'utf8')
  assert.ok(upload.includes('bannedClaims(words)'))
})

test('the stored cover is a 1200×630 JPEG under 250 KB', async () => {
  const monogram = `data:image/png;base64,${readFileSync(path.join(process.cwd(), 'public', 'brand', 'tutormint-monogram.png')).toString('base64')}`
  for (const seed of [0, 2]) {
    const sel = selectCover(base, seed)
    const res = renderCoverPng({ title: base.title, selection: sel, assets: { city: assetUri(sel.citySlug), person: assetUri(sel.personSlug), motifs: sel.motifs.map(assetUri), monogram } })
    const jpg = await coverJpeg(new Uint8Array(await res.arrayBuffer()))
    const meta = await sharp(jpg).metadata()
    assert.equal(meta.format, 'jpeg')
    assert.equal(meta.width, 1200)
    assert.equal(meta.height, 630)
    assert.ok(jpg.length <= COVER_MAX_BYTES, `${jpg.length} bytes`)
  }
})

test('alt text comes from the title and the scene; the prompt asks for a scene with no text', () => {
  const input = post({ title: 'How to find a good Primary Islamiat tutor in Lahore', city: 'Lahore', subject: 'Primary Islamiat' })
  const alt = coverAltText(input, selectCover(input, 0))
  assert.ok(alt.startsWith('Cover for “How to find a good Primary Islamiat tutor in Lahore”: '))
  assert.ok(alt.includes('the Lahore skyline') && alt.includes('a Quran on a stand'))
  assert.ok(alt.length <= 300)
  // The route stores the prompt with the cover, and the editor shows it.
  const route = readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'blog', 'generate-cover', 'route.ts'), 'utf8')
  assert.ok(route.includes('coverPrompt,') && route.includes("contentType: 'image/jpeg'") && route.includes('upsert: false'))
  // The stored prompt is the clean paragraph alone — no note about the library.
  assert.ok(!route.includes('Composed by TutorMint'))
  assert.ok(readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'blog', 'route.ts'), 'utf8').includes('cover_prompt:'))
  const editor = readFileSync(path.join(process.cwd(), 'components', 'admin', 'blog', 'PostEditor.tsx'), 'utf8')
  assert.ok(editor.includes('Image prompt used for this cover') && editor.includes('grid grid-cols-3') && editor.includes('or upload your own'))
  assert.ok(editor.includes('Regenerate prompt') && editor.includes('freshCoverPrompt()'))
})

test('the teacher illustrations are named by what they show', async () => {
  // teacher-male.png is the man holding a book (436 wide); teacher-female.png is
  // the woman holding a tablet (400 wide). They were swapped before 14 Oct 2026.
  assert.equal(coverAsset('teacher-male')?.width, 436)
  assert.equal(coverAsset('teacher-female')?.width, 400)
  for (const slug of ['teacher-male', 'teacher-female']) {
    const a = coverAsset(slug)!
    const meta = await sharp(path.join(COVERS_DIR, a.file)).metadata()
    assert.equal(meta.width, a.width, slug)
    assert.equal(meta.height, a.height, slug)
  }
  const build = readFileSync(path.join(process.cwd(), 'scripts', 'covers-build.ts'), 'utf8')
  assert.ok(build.includes("{ token: 'Teacher_holding_open', slug: 'teacher-male'"))
  assert.ok(build.includes("{ token: 'Teacher_holding_tablet', slug: 'teacher-female'"))
  // The alt text says which.
  const career = { title: 'How to become a home tutor', cluster: 'tutor-career', city: null, subject: null, audience: 'tutors' as const, slug: 'c' }
  const words = [0, 3].map((seed) => coverAltText(career, selectCover(career, seed)))
  assert.ok(words.some((w) => w.includes('a female teacher holding a tablet')))
  assert.ok(words.some((w) => w.includes('a male teacher holding a book')))
})
