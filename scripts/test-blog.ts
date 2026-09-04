/**
 * scripts/test-blog.ts — the two pure pieces of the blog worth testing without
 * a database or network: the constrained Markdown renderer (its safety is the
 * point) and the a/an article helper.
 *
 *   npm run test:blog
 *
 * node:test, like the other script tests. The renderer's guarantee — source
 * text can never become a tag — is exactly the kind of property a unit test
 * pins, so a future "small tweak" to the inline pass cannot quietly open an
 * XSS hole.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseMarkdown, plainText } from '../lib/markdown'
import { article, withArticle } from '../lib/article'
import {
  composeBlogDraft,
  figureGate,
  unsupportedFigures,
  withBrandTail,
  type BlogBrief,
} from '../lib/ai/blogBrief'

function html(md: string): string {
  return parseMarkdown(md)
    .segments.filter((s) => s.kind === 'html')
    .map((s) => (s.kind === 'html' ? s.html : ''))
    .join('')
}

test('script tags are escaped, never emitted', () => {
  const out = html('Hello <script>alert(1)</script> world')
  assert.ok(!out.includes('<script>'), 'raw <script> must not appear')
  assert.ok(out.includes('&lt;script&gt;'), 'it should be escaped')
})

test('javascript: links are dropped to plain text', () => {
  const out = html('[click](javascript:alert(1))')
  assert.ok(!/href="javascript:/i.test(out), 'no javascript: href')
  assert.ok(out.includes('click'), 'the text survives')
})

test('http and relative links are kept, external ones get nofollow', () => {
  const ext = html('[a](https://example.com)')
  assert.ok(/href="https:\/\/example.com"/.test(ext))
  assert.ok(/rel="noopener nofollow"/.test(ext))
  const rel = html('[b](/browse/tutors)')
  assert.ok(/href="\/browse\/tutors"/.test(rel))
  assert.ok(!/rel=/.test(rel), 'internal links carry no nofollow')
})

test('a digit run in prose survives inline processing', () => {
  const out = html('We list 3 tutors in 5 areas')
  assert.ok(out.includes('3 tutors'), 'sentinel restore must not eat "3"')
  assert.ok(out.includes('5 areas'))
})

test('headings produce ids and a table of contents', () => {
  const { segments, headings } = parseMarkdown('## First\n\ntext\n\n### Second')
  assert.equal(headings.length, 2)
  assert.deepEqual(headings[0], { id: 'first', text: 'First', level: 2 })
  assert.equal(headings[1].level, 3)
  const joined = segments.filter((s) => s.kind === 'html').map((s) => (s.kind === 'html' ? s.html : '')).join('')
  assert.ok(joined.includes('<h2 id="first">'))
})

test('embed lines become embed segments', () => {
  const { segments } = parseMarkdown('intro\n\n{{tutor:ali-raza}}\n\nmore\n\n{{job:o-level-physics-ab12}}')
  const embeds = segments.filter((s) => s.kind === 'embed')
  assert.equal(embeds.length, 2)
  assert.deepEqual(embeds[0], { kind: 'embed', embed: { type: 'tutor', slug: 'ali-raza' } })
  assert.equal(embeds[1].kind === 'embed' && embeds[1].embed.type, 'job')
})

test('bold and italic render', () => {
  const out = html('**bold** and *italic*')
  assert.ok(out.includes('<strong>bold</strong>'))
  assert.ok(out.includes('<em>italic</em>'))
})

test('reading time is at least one minute and plainText strips embeds', () => {
  const { readingTime } = parseMarkdown('one two three')
  assert.equal(readingTime, 1)
  assert.ok(!plainText('{{tutor:x}}\n\nhello').includes('tutor'))
})

test('article picks a/an by sound, not by letter', () => {
  // Acronyms / capitals judged by the spoken first letter.
  assert.equal(article('O Levels'), 'an')
  assert.equal(article('A Levels'), 'an')
  assert.equal(article('IGCSE'), 'an')
  assert.equal(article('MDCAT'), 'an')
  assert.equal(article('SAT'), 'an')
  assert.equal(article('GCSE'), 'a')
  assert.equal(article('BSc'), 'a')
  // Ordinary words.
  assert.equal(article('Mathematics'), 'a')
  assert.equal(article('Physics'), 'a')
  assert.equal(article('English'), 'an')
  assert.equal(article('Urdu'), 'an')
  // Vowel letter, consonant sound.
  assert.equal(article('university'), 'a')
  assert.equal(article('European history'), 'a')
  // Silent h.
  assert.equal(article('hour'), 'an')
  assert.equal(withArticle('O Levels'), 'an O Levels')
})

// ------------------------------------------------- GFM tables (renderer) ----

test('a pipe table renders as a real table, cells escaped', () => {
  const out = html('| Board | Fee |\n| --- | --- |\n| Cambridge | Rs 8,000 |\n| Edexcel | Rs 9,000 |')
  assert.ok(out.includes('<table>'), 'a table element is emitted')
  assert.ok(out.includes('<th>Board</th>'), 'header cell')
  assert.ok(out.includes('<td>Cambridge</td>'), 'body cell')
  assert.ok(out.includes('Rs 8,000'), 'cell content survives')
})

test('a table cell cannot become a tag', () => {
  const out = html('| A | B |\n| --- | --- |\n| <img src=x> | ok |')
  assert.ok(!/<img src=x>/.test(out), 'raw tag must not appear')
  assert.ok(out.includes('&lt;img'), 'it is escaped')
})

test('a lone pipe line is a paragraph, not a table', () => {
  const out = html('This costs Rs 10 | 20 per hour')
  assert.ok(!out.includes('<table>'), 'no delimiter row means no table')
  assert.ok(out.includes('<p>'), 'it stays a paragraph')
})

// --------------------------------------------- figure verifier (blog AI) ----

const NOTES = 'O Level fees are Rs 8,000 to 15,000 a month. Cambridge and Edexcel boards.'

test('a figure in the notes is not flagged', () => {
  assert.deepEqual(unsupportedFigures('Fees run about Rs 8,000.', NOTES, ''), [])
})

test('a figure that appears in neither notes nor title is flagged', () => {
  assert.deepEqual(unsupportedFigures('Pass rates hit 92% last year.', NOTES, ''), ['92'])
})

test('a figure in the title is allowed (the manager asserted it)', () => {
  assert.deepEqual(unsupportedFigures('Great for Grade 10 students.', '', 'Grade 10 physics guide'), [])
})

test('comma and bare forms of one number are the same figure', () => {
  assert.deepEqual(unsupportedFigures('Around 15000 rupees.', NOTES, ''), [])
})

test('a confirmed figure counts as traced', () => {
  assert.deepEqual(unsupportedFigures('Roughly 92% pass.', NOTES, '', ['92']), [])
})

test('figureGate is inactive with no notes (part-1 hand-written flow)', () => {
  const g = figureGate('A post mentioning 5 tips and 92%.', '', 'Five tips')
  assert.equal(g.active, false)
  assert.deepEqual(g.untraced, [])
})

test('figureGate is active and flags with notes present', () => {
  const g = figureGate('Pass rates hit 92%.', NOTES, 'Physics fees')
  assert.equal(g.active, true)
  assert.deepEqual(g.untraced, ['92'])
})

// ---------------------------------------------------- SEO + composer --------

test('withBrandTail ends with the brand line and fits 155', () => {
  const d = withBrandTail('A short lead about O Level Physics tutors in Lahore')
  assert.ok(d.length <= 155, `length ${d.length} must be <= 155`)
  assert.ok(d.includes('No fee, no commission, no middleman.'), 'brand line present')
})

test('withBrandTail does not double the brand line', () => {
  const d = withBrandTail('Find tutors — no commission at all')
  assert.equal((d.match(/no commission/gi) ?? []).length, 1)
})

test('the composed fallback invents no figure not in its notes', () => {
  const brief: BlogBrief = {
    title: 'O Level Physics tutors in Lahore',
    clusterLabel: 'Subject guides',
    audience: 'parents',
    language: 'en',
    notes: 'Fees are Rs 8,000 to 15,000. In-person in DHA and Gulberg.',
    landingLinks: [],
  }
  const draft = composeBlogDraft(brief)
  assert.deepEqual(unsupportedFigures(draft.body, brief.notes, brief.title), [])
  assert.equal(draft.source, 'composed')
})

// -------------------------------------- figure exemption for landing links --

test('digits in a real landing page title are exempt when the body links to it', () => {
  const landing = [
    { path: 'tuitions/lahore/grade-1-to-5-mathematics', label: 'Grade 1 to 5 Mathematics · Lahore (tuitions)' },
  ]
  const body = 'See [Grade 1 to 5 Mathematics · Lahore](/tuitions/lahore/grade-1-to-5-mathematics) for options.'
  assert.deepEqual(unsupportedFigures(body, 'notes with no numbers', 'A guide', [], landing), [])
})

test('a statistic smuggled into a landing link label is still flagged', () => {
  const landing = [{ path: 'tutors/lahore/o-levels-physics', label: 'O Levels Physics · Lahore (tutors)' }]
  const body = 'Our tutors get [an 83% pass rate](/tutors/lahore/o-levels-physics).'
  assert.deepEqual(unsupportedFigures(body, 'notes', 'A guide', [], landing), ['83'])
})

test('a digit in a link to an unknown path is not exempt', () => {
  const body = 'Read the [Grade 10 guide](/tutors/lahore/made-up) about grade 10.'
  assert.deepEqual(unsupportedFigures(body, 'notes', 'A guide', [], []), ['10'])
})

// ------------------------------------- ordered-list markers are not stats ---

test('ordered-list enumerators are not flagged as figures', () => {
  const body = 'Steps:\n\n1. Pick a tutor\n2. Book a demo\n3. Start lessons'
  assert.deepEqual(unsupportedFigures(body, 'notes with no numbers', 'A guide'), [])
})

test('a statistic inside ordered-list text is still flagged', () => {
  const body = '1. Fees can reach 25000 rupees a month'
  assert.deepEqual(unsupportedFigures(body, 'notes', 'A guide'), ['25000'])
})

// ------------------------------------------------ content queue (9.4) core --

import {
  priorityOf,
  gapAgeFactor,
  evidenceHash,
  calendarCandidates,
} from '../lib/contentQueue/core'

test('priority is the product of its components', () => {
  assert.equal(priorityOf({ demand: 40, rankProximity: 1.5, seasonality: 1, gapAge: 1 }), 60)
  assert.equal(priorityOf({ demand: 20, rankProximity: 1, seasonality: 3, gapAge: 2 }), 120)
})

test('gapAge rises one step per fortnight, capped at 4', () => {
  const now = new Date('2026-03-01T00:00:00Z')
  assert.equal(gapAgeFactor(now, now), 1)
  assert.equal(gapAgeFactor(new Date('2026-02-15T00:00:00Z'), now), 2)
  assert.equal(gapAgeFactor(new Date('2025-01-01T00:00:00Z'), now), 4)
})

test('evidence hash is stable under a small change, moves on a big one', () => {
  assert.equal(evidenceHash({ searches: 40 }), evidenceHash({ searches: 43 }))
  assert.notEqual(evidenceHash({ searches: 40 }), evidenceHash({ searches: 90 }))
})

test('a dismissed topic returns only when its evidence changes materially', () => {
  // The rebuild resurfaces a dismissed row when the new hash differs.
  const dismissedHash = evidenceHash({ searches: 40, tutors: 0 })
  assert.equal(evidenceHash({ searches: 44, tutors: 0 }), dismissedHash) // stays dismissed
  assert.notEqual(evidenceHash({ searches: 120, tutors: 0 }), dismissedHash) // returns
})

test('the calendar suggests a topic six weeks ahead, with the year in the id', () => {
  // Nov 5 2026 is ~26 days before board registration opens (Dec 1).
  const cands = calendarCandidates(new Date('2026-11-05T00:00:00Z'))
  const reg = cands.find((c) => c.fingerprint.startsWith('calendar:board-registration:'))
  assert.ok(reg, 'board registration should be suggested')
  assert.equal(reg!.fingerprint, 'calendar:board-registration:2026')
  assert.equal(reg!.cluster, 'boards-exams')
})

test('the calendar suggests nothing far from any event', () => {
  // Deep in a quiet stretch: nothing within six weeks.
  const cands = calendarCandidates(new Date('2026-10-12T00:00:00Z'))
  assert.equal(cands.length, 0)
})
