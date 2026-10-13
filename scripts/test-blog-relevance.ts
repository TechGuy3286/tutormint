// npm run test:blogrelevance — what is related to a blog post, the cover brand
// line and its banned-word guard, and which tutors the writer may name
// (owner, 13 Oct 2026). Offline: pure functions, one cover render, source scans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  groupOfText,
  matchTier,
  matchingTutorSlugs,
  postTopic,
  rankRelatedPosts,
  relevantItems,
  subjectOfText,
  type TutorForPost,
} from '../lib/blogRelevanceCore'
import { BRAND_LINE_GROWING, bannedClaims, brandLine, coverTextProblem, superlativeClaims } from '../lib/brandClaims'
import { CoverTextError, renderCoverPng } from '../lib/covers/compose'
import { selectCover } from '../lib/covers/select'
import { coverImagePrompt } from '../lib/covers/prompt'
import { collectBlogProblems } from '../lib/ai/blogChecker'

const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8')

// The post the owner saw: /blog/how-to-find-a-good-primary-islamiat-tutor-in-lahore
const ISLAMIAT = { city: 'Lahore', subject: 'Primary Islamiat', title: 'How to find a good Primary Islamiat tutor in Lahore' }

const page = (kind: 'tutors' | 'tuitions', city: string, level: string, subject: string, count = 3) => ({
  path: `${kind}/${city.toLowerCase()}/${`${level} ${subject}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  kind,
  city,
  level,
  subject,
  count,
})

test('a post topic is read from its City and Subject fields', () => {
  assert.equal(groupOfText('Primary Islamiat'), 'primary')
  assert.equal(subjectOfText('Primary Islamiat'), 'islamiat')
  assert.equal(groupOfText('Grade 9 & 10 - Science English'), 'matric')
  assert.equal(subjectOfText('Grade 9 & 10 - Science English'), 'english')
  assert.equal(subjectOfText('Grade 9 & 10 - Science Physics'), 'physics')
  assert.equal(groupOfText('O Level Physics'), 'o-level')
  assert.equal(subjectOfText('O Level Physics'), 'physics')
  assert.equal(groupOfText('Grade 4'), 'primary')
  assert.equal(groupOfText('Grade 7'), 'middle')
  const t = postTopic(ISLAMIAT)
  assert.equal(t.city, 'lahore')
  assert.equal(t.group, 'primary')
  assert.ok(t.subjects.includes('islamiat'))
  // No subject field: the level may still come from the title; no subject is guessed.
  const career = postTopic({ title: 'How to become a home tutor in Pakistan: a step-by-step start' })
  assert.deepEqual(career, { city: '', group: '', subjects: [] })
})

test('the tiers: subject + level + city, subject + city, level + city, city only', () => {
  const t = postTopic(ISLAMIAT)
  assert.equal(matchTier(t, { city: 'Lahore', level: 'Grade 4', subject: 'Islamiat / Islamic Studies' }), 1)
  assert.equal(matchTier(t, { city: 'Lahore', level: 'Grade 7', subject: 'Islamiyat / Islamic Studies' }), 2)
  assert.equal(matchTier(t, { city: 'Lahore', level: 'Grade 4', subject: 'English' }), 3)
  assert.equal(matchTier(t, { city: 'Lahore', level: 'Grade 7', subject: 'English' }), 4)
  // Another city is never related to a post that has a city.
  assert.equal(matchTier(t, { city: 'Karachi', level: 'Grade 4', subject: 'Islamiat / Islamic Studies' }), 0)
  // "Science" is not "Computer Science"; "Maths" is "Mathematics".
  const sci = postTopic({ city: 'Lahore', subject: 'Primary Science' })
  assert.equal(matchTier(sci, { city: 'Lahore', level: 'Grade 4', subject: 'General Science' }), 1)
  assert.equal(matchTier(sci, { city: 'Lahore', level: 'Grade 4', subject: 'Computer Science' }), 3)
  const maths = postTopic({ subject: 'Matric Maths' })
  assert.equal(matchTier(maths, { city: 'Multan', level: 'Grade 9 - Science', subject: 'Mathematics' }), 1)
})

test('"Browse verified listings": the pages the owner saw are no longer related', () => {
  const t = postTopic(ISLAMIAT)
  // What the sidebar showed: Grade 7 English, Grade 7 Urdu, Grade 4 English — all Lahore.
  const before = [page('tutors', 'Lahore', 'Grade 7', 'English'), page('tutors', 'Lahore', 'Grade 7', 'Urdu'), page('tutors', 'Lahore', 'Grade 4', 'English')]
  const withIslamiat = [...before, page('tuitions', 'Lahore', 'Grade 3', 'Islamiat / Islamic Studies', 5), page('tutors', 'Lahore', 'Grade 6', 'Islamiat / Islamic Studies', 4)]
  const picked = relevantItems(withIslamiat, t)
  // Order: subject + level + city, then subject + city, then level + city.
  assert.deepEqual(picked.map((p) => [p.subject, p.level, p.tier]), [
    ['Islamiat / Islamic Studies', 'Grade 3', 1],
    ['Islamiat / Islamic Studies', 'Grade 6', 2],
    ['English', 'Grade 4', 3],
  ])
  // Grade 7 English / Urdu (city only) are NOT shown while something closer exists.
  assert.ok(!picked.some((p) => p.level === 'Grade 7' && p.subject !== 'Islamiat / Islamic Studies'))
  // The PUBLIC box shows only the closest tier that has anything: with
  // Islamiat pages for the level, Grade 4 English is not shown at all.
  assert.deepEqual(relevantItems(withIslamiat, t, { closestOnly: true }).map((p) => [p.subject, p.level]), [['Islamiat / Islamic Studies', 'Grade 3']])
  assert.deepEqual(relevantItems(before, t, { closestOnly: true }).map((p) => [p.subject, p.level]), [['English', 'Grade 4']])
  assert.ok(read('lib', 'blogRelevance.ts').includes('closestOnly: true'))
  // City-only pages are the last resort, used only when nothing closer exists.
  const cityOnly = relevantItems([page('tutors', 'Lahore', 'Grade 7', 'English'), page('tutors', 'Lahore', 'Grade 7', 'Urdu')], t)
  assert.deepEqual(cityOnly.map((p) => p.tier), [4, 4])
})

test('nothing related → an empty list, so the box is hidden', () => {
  const t = postTopic(ISLAMIAT)
  assert.deepEqual(relevantItems([page('tutors', 'Karachi', 'Grade 7', 'English')], t), [])
  // A post with no city, level or subject has nothing a page can match.
  assert.deepEqual(relevantItems([page('tutors', 'Lahore', 'Grade 7', 'English')], postTopic({ title: 'Group tuition versus one-to-one' })), [])
  // The component renders nothing for an empty list.
  const box = read('components', 'blog', 'RelatedLanding.tsx')
  assert.ok(box.includes('if (!items || items.length === 0) return null'))
  // The page asks the relevance rule, at render, for every post.
  const pg = read('app', '(site)', 'blog', '[slug]', 'page.tsx')
  assert.ok(pg.includes('landingForPost(post, post.relatedLandingPages)'))
  assert.ok(pg.includes('related.length > 0 &&'))
  // Only indexable pages are offered.
  const rel = read('lib', 'blogRelevance.ts')
  assert.ok(rel.includes('liveLandingPages()') && rel.includes('liveOverlapNoindex()'))
})

test('an author’s unrelated pick is never shown; a related pick comes first in its tier', () => {
  const t = postTopic(ISLAMIAT)
  const a = page('tuitions', 'Lahore', 'Grade 3', 'Islamiat / Islamic Studies', 9)
  const b = page('tuitions', 'Lahore', 'Grade 5', 'Islamiat / Islamic Studies', 3)
  const junk = page('tutors', 'Lahore', 'Grade 7', 'English', 50)
  const out = relevantItems([a, b, junk], t, { preferred: new Set([b.path, junk.path]) })
  assert.deepEqual(out.map((p) => p.path), [b.path, a.path])
})

test('"Related reading": same subject, then level, then city, then cluster — never unrelated', () => {
  const current = { id: 'me', ...ISLAMIAT, cluster: 'subject-guides' }
  const others = [
    { id: 'city', city: 'Lahore', subject: 'Grade 9 & 10 - Science English', title: 'Grade 9 & 10 English tutors in Lahore', cluster: 'cost-hiring', publishedAt: '2026-09-09' },
    { id: 'subject', city: 'Karachi', subject: 'Middle Islamiat', title: 'Islamiat in Karachi', cluster: 'cost-hiring', publishedAt: '2026-09-01' },
    { id: 'level', city: 'Multan', subject: 'Primary Maths', title: 'Primary Maths in Multan', cluster: 'cost-hiring', publishedAt: '2026-09-02' },
    { id: 'cluster', city: null, subject: null, title: 'How to choose a subject guide', cluster: 'subject-guides', publishedAt: '2026-09-03' },
    { id: 'none', city: 'Karachi', subject: 'O Level Physics', title: 'O Level Physics in Karachi', cluster: 'cost-hiring', publishedAt: '2026-10-01' },
  ]
  assert.deepEqual(rankRelatedPosts(current, others, 10).map((p) => p.id), ['subject', 'level', 'city', 'cluster'])
  assert.deepEqual(rankRelatedPosts(current, others, 3).map((p) => p.id), ['subject', 'level', 'city'])
  // Nothing in common → hidden.
  assert.deepEqual(rankRelatedPosts(current, [others[4]]), [])
  // A post never relates to itself.
  assert.deepEqual(rankRelatedPosts(current, [{ ...current }]), [])
})

const TUTORS: TutorForPost[] = [
  { slug: 'islamiat-primary-lahore', city: 'Lahore', subjects: [{ level: 'Grade 3', subject: 'Islamiat / Islamic Studies' }] },
  { slug: 'islamiat-matric-lahore', city: 'Lahore', subjects: [{ level: 'Grade 9 - Science', subject: 'Islamiyat / Islamic Studies' }] },
  { slug: 'islamiat-primary-karachi', city: 'Karachi', subjects: [{ level: 'Grade 4', subject: 'Islamiat / Islamic Studies' }] },
  { slug: 'english-primary-lahore', city: 'Lahore', subjects: [{ level: 'Grade 4', subject: 'English' }] },
]

test('the writer names only an indexable tutor who teaches the post’s subject at its level, in its city', () => {
  assert.deepEqual(matchingTutorSlugs(postTopic(ISLAMIAT), TUTORS), ['islamiat-primary-lahore'])
  // No city on the post: the city is not required.
  assert.deepEqual(matchingTutorSlugs(postTopic({ subject: 'Primary Islamiat' }), TUTORS), ['islamiat-primary-lahore', 'islamiat-primary-karachi'])
  // No subject on the post → no tutor at all.
  assert.deepEqual(matchingTutorSlugs(postTopic({ city: 'Lahore', title: 'Finding a home tutor in Lahore' }), TUTORS), [])
  // None match → none named.
  assert.deepEqual(matchingTutorSlugs(postTopic({ city: 'Lahore', subject: 'O Level Physics' }), TUTORS), [])
  // Only INDEXABLE tutors are ever candidates (the sitemap's own list).
  assert.ok(read('lib', 'blogRelevance.ts').includes("db.rpc('listed_tutor_slugs')"))
  // The writer is told so, in every prompt that writes or fixes prose.
  const copy = read('lib', 'ai', 'blogCopy.ts')
  assert.ok(copy.includes('name NO tutor in this post'))
  assert.ok(copy.includes('Never invent a tutor'))
  assert.equal(copy.split('tutorRule(brief)').length - 1, 4, 'full draft, section, short section, fix')
  assert.equal(copy.split('NO_SUPERLATIVE_RULE,').length - 1, 4)
  // The writer is offered only matching links and tutors.
  const gen = read('lib', 'blogGenerate.ts')
  assert.ok(gen.includes('rel.landing.map(') && gen.includes('rel.tutors.slice(0, 6)'))
})

test('the checker flags a named tutor who does not match, and an unrelated landing link', () => {
  const base = {
    publishedPostSlugs: [],
    landingPaths: ['/tutors/lahore/grade-7-english', '/tuitions/lahore/grade-3-islamiat-islamic-studies'],
    tutorSlugs: ['english-primary-lahore', 'islamiat-primary-lahore'],
    relatedLandingPaths: ['/tuitions/lahore/grade-3-islamiat-islamic-studies'],
    matchingTutorSlugs: ['islamiat-primary-lahore'],
    tutorNames: { 'english-primary-lahore': 'Sana Riaz', 'islamiat-primary-lahore': 'Hafiz Bilal' },
  }
  const bad = 'Tutors like [Sana Riaz](/tutor/english-primary-lahore) can help. See [Grade 7 English tutors in Lahore](/tutors/lahore/grade-7-english).'
  const kinds = collectBlogProblems(bad, base).map((p) => p.kind)
  assert.ok(kinds.includes('tutor_mismatch'))
  assert.ok(kinds.includes('unrelated_link'))
  // A tutor named WITHOUT a link is caught too.
  assert.ok(collectBlogProblems('A tutor such as Sana Riaz teaches this.', base).some((p) => p.kind === 'tutor_mismatch'))
  // The matching tutor and the related page are fine.
  const good = 'Tutors like [Hafiz Bilal](/tutor/islamiat-primary-lahore) teach it. See [Grade 3 Islamiat tuitions in Lahore](/tuitions/lahore/grade-3-islamiat-islamic-studies).'
  const goodKinds = collectBlogProblems(good, base).map((p) => p.kind)
  assert.ok(!goodKinds.includes('tutor_mismatch') && !goodKinds.includes('unrelated_link'))
  // The publish gate passes the post, so the server enforces it too.
  assert.ok(read('app', 'api', 'admin', 'blog', 'route.ts').includes('liveCheckerData(post!.slug as string, {'))
})

test('no superlative or unprovable claim about TutorMint in a post', () => {
  assert.equal(superlativeClaims("TutorMint is Pakistan's largest tutors network.").length, 1)
  assert.equal(superlativeClaims('TutorMint is the best platform for finding a tutor.').length, 1)
  assert.equal(superlativeClaims('TutorMint is the No.1 and most trusted site.').length, 1)
  // Not a claim about us.
  assert.deepEqual(superlativeClaims('The best time to start revising is eight weeks before the exam.'), [])
  assert.deepEqual(superlativeClaims('Choose the tutor who is the best fit for your child. TutorMint lists verified tutors first.'), [])
  const p = collectBlogProblems('TutorMint is the largest tutors network in Pakistan.', { publishedPostSlugs: [], landingPaths: [] })
  assert.ok(p.some((x) => x.kind === 'superlative'))
})

test('the brand line switches at 100 and rounds down to the nearest 50', () => {
  assert.equal(BRAND_LINE_GROWING, "Pakistan's fast-growing tutor network")
  for (const n of [0, 1, 6, 99]) assert.equal(brandLine(n), BRAND_LINE_GROWING, String(n))
  assert.equal(brandLine(100), '100+ verified tutors across Pakistan')
  assert.equal(brandLine(149), '100+ verified tutors across Pakistan')
  assert.equal(brandLine(150), '150+ verified tutors across Pakistan')
  assert.equal(brandLine(199), '150+ verified tutors across Pakistan')
  assert.equal(brandLine(1234), '1200+ verified tutors across Pakistan')
  assert.equal(brandLine(Number.NaN), BRAND_LINE_GROWING)
  // Neither line trips the guard.
  for (const n of [0, 100, 250]) assert.equal(coverTextProblem(brandLine(n)), null)
  // The count is the live number of tutors holding the Verified badge, by the site's own rule.
  const render = read('lib', 'covers', 'render.ts')
  assert.ok(render.includes('loadVerifiedBadgeOk(') && render.includes('brandLine(await verifiedBadgeTutorCount())'))
})

test('the guard rejects any cover text with a banned word', () => {
  assert.deepEqual(bannedClaims("Pakistan's Largest Tutors Network"), ['largest'])
  for (const t of ['The BEST tutors in Lahore', 'No.1 tutor network', 'No 1 in Pakistan', 'Number one for tutors', '#1 tutor site', 'Most trusted tutors', 'Most-Trusted network', 'The leading tutor network', 'Top-rated tutors', 'The biggest network']) {
    assert.ok(coverTextProblem(t), t)
  }
  for (const t of ['How to find a good Primary Islamiat tutor in Lahore', "Pakistan's fast-growing tutor network", '150+ verified tutors across Pakistan', 'Grade 1 to 5 Maths tutors']) {
    assert.equal(coverTextProblem(t), null, t)
  }
  const sel = selectCover({ title: 'x', cluster: 'subject-guides', city: 'Lahore', subject: null, audience: 'parents', slug: 'x' }, 0)
  const assets = { city: null, person: null, motifs: [] }
  // A banned TITLE is never painted…
  assert.throws(() => renderCoverPng({ title: "Pakistan's largest tutor network", selection: sel, assets }), CoverTextError)
  // …nor a banned brand line, whoever passes it.
  assert.throws(() => renderCoverPng({ title: 'Primary Islamiat in Lahore', selection: sel, assets, brandLine: "Pakistan's Largest Tutors Network" }), CoverTextError)
  // A clean cover renders.
  assert.ok(renderCoverPng({ title: 'Primary Islamiat in Lahore', selection: sel, assets, brandLine: brandLine(6) }) instanceof Response)
  // Both routes turn it into a 400; an UPLOADED cover is read and refused too.
  assert.ok(read('app', 'api', 'admin', 'blog', 'generate-cover', 'route.ts').includes('coverTextProblem(d.title)'))
  assert.ok(read('app', 'api', 'admin', 'blog', 'cover-compose', 'route.tsx').includes('CoverTextError'))
  const upload = read('app', 'api', 'admin', 'blog', 'cover', 'route.ts')
  assert.ok(upload.includes('bannedClaims(words)') && upload.includes('status: 400'))
})

test('no template or image prompt carries a superlative; the editor can regenerate a cover', () => {
  const compose = read('lib', 'covers', 'compose.tsx')
  assert.ok(!/largest/i.test(compose.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
  const prompt = coverImagePrompt({ title: 'Primary Islamiat in Lahore', clusterLabel: 'Subject guides', city: 'Lahore', subject: 'Primary Islamiat' })
  assert.ok(prompt.includes('NO text'))
  assert.ok(prompt.includes('never add a slogan or a claim'))
  assert.ok(read('components', 'admin', 'blog', 'PostEditor.tsx').includes('Regenerate cover'))
})
