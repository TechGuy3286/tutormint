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
