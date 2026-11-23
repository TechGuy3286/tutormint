/**
 * scripts/test-pr20.ts — npm run test:pr20
 *
 * PR-20 (owner, 24 Nov 2026): Contact Us page + Google Business Profile, blog
 * editor fixes ("Fix it with AI", auto settings, compact job cards), reading
 * tuitions from images. Pure rules run directly; the image pipeline runs real
 * OCR on INVENTED images built in memory (scripts/fixtures/pr20Images — the
 * number 0300 1234567 is made up) with the AI mocked; wiring is checked in the
 * source. Reads nothing from production and writes nothing anywhere.
 */
import assert from 'node:assert/strict'
import fs, { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { CONTACT_SENT, contactEmail, HONEYPOT_FIELD, maskContact, parseContact, showContact } from '../lib/contactFormCore'
import { organizationJsonLd } from '../lib/seo'
import { googleBusinessUrl, PUBLIC_LOCATION, socialProfiles } from '../lib/siteIdentity'
import { decideAll, NO_FACTS } from '../lib/email/policyCore'
import { figureGate, unsupportedFigures } from '../lib/ai/blogBrief'
import { applyFigureRewrite, figureFixProblem, figureRewrite, mentionsFigure, sentenceWithFigure, undoFigureRewrite } from '../lib/blogFigureFixCore'
import { applyAuto, autoCoverAlt, autoRelatedPaths, inferSettings, replaceableAlt } from '../lib/blogAutoSettingsCore'
import { postTopic } from '../lib/blogRelevanceCore'
import { chooseLiveJobs, compactJobTitle, compactLevelSubjectLine, LIVE_JOBS_LIMIT } from '../lib/liveJobsCore'
import { asciiDigits, digitLookalikes, IMAGE_MAX_BYTES, IMAGE_UNSAFE, imageTypeOk, numberLeft, planMask, urduContactLines, type OcrLine } from '../lib/imageMaskCore'
import { hasNumberLeft } from '../lib/postRedactCore'
import { hiringPoster, INVENTED_MOBILE, noNumberPoster, screenshotPost, urduDigitsPoster } from './fixtures/pr20Images'

let failures = 0
const tests: { name: string; fn: () => void | Promise<void> }[] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn })
const src = (p: string) => readFileSync(p, 'utf8')

// ─────────────────────────────────────────────── PART A — Contact Us ──

test('A.1 the contact form accepts a mobile or an email, refuses junk, drops the honeypot', () => {
  const ok = parseContact({ name: 'Invented Person', contact: '0300 1234567', message: 'I need help posting a tuition.' })
  assert.ok(ok.ok && !ok.spam && ok.kind === 'mobile' && ok.contact === '923001234567')
  const em = parseContact({ name: 'Invented Person', contact: 'Someone@Example.com', message: 'A question about academies.' })
  assert.ok(em.ok && !em.spam && em.kind === 'email' && em.contact === 'someone@example.com')
  assert.equal(parseContact({ name: 'A', contact: '03001234567', message: 'long enough message' }).ok, false, 'name needed')
  assert.equal(parseContact({ name: 'Invented', contact: 'not a contact', message: 'long enough message' }).ok, false, 'contact needed')
  assert.equal(parseContact({ name: 'Invented', contact: '03001234567', message: 'short' }).ok, false, 'message needed')
  const bot = parseContact({ name: 'x', contact: 'y', message: 'z', [HONEYPOT_FIELD]: 'http://spam.example' })
  assert.ok(bot.ok && bot.spam, 'a filled honeypot is spam (answered "sent", never stored)')
  assert.ok(CONTACT_SENT.length > 10)
})

test('A.1 the contact is masked in the inbox, the email subject carries nothing personal', () => {
  assert.equal(maskContact('923001234567', 'mobile'), '0300 •••• 567')
  assert.equal(maskContact('someone@example.com', 'email'), 's•••@example.com')
  assert.equal(showContact('923001234567', 'mobile').replace(/\D/g, ''), '03001234567')
  const mail = contactEmail({ name: 'Invented Person', contact: '923001234567', kind: 'mobile', message: 'Hello', inboxUrl: 'https://www.tutormint.org/admin/inbox/contact' })
  assert.ok(!/\d{4}|Invented|@/.test(mail.subject), 'subject is fixed text')
  assert.ok(mail.text.includes('Hello') && mail.text.includes('/admin/inbox/contact'))
})

test('A.1 every contact-form email is sent (never de-duplicated to the one support mailbox)', () => {
  const d = decideAll([{ to: 'support@tutormint.org', template: 'contact_form' }, { to: 'support@tutormint.org', template: 'contact_form' }], NO_FACTS)
  assert.deepEqual(d.map((x) => x.action), ['send', 'send'])
})

test('A.1 rate limit: 5 an hour per IP, checked before storing; honeypot before the limit', () => {
  const rl = src('lib/rateLimit.ts')
  assert.match(rl, /contact_form: \{ windowSeconds: 3600, max: 5 \}/)
  const route = src('app/api/contact/route.ts')
  assert.ok(route.indexOf("rateLimit('contact_form', callerIp(request))") < route.indexOf('submitContactMessage(parsed'), 'limit before store')
  assert.ok(route.indexOf('parsed.spam') < route.indexOf("rateLimit('contact_form'"), 'honeypot answered first')
})

test('A.1 nothing from the form is logged in plain text', () => {
  for (const f of ['app/api/contact/route.ts', 'lib/contactForm.ts', 'app/api/admin/contact-messages/route.ts']) {
    const s = src(f)
    for (const m of s.matchAll(/console\.(?:log|warn|error)\(([^\n]*)/g)) {
      const code = m[1].replace(/'[^']*'/g, '').replace(/\b(?:error|e)\??\.message\b/g, '')
      assert.ok(!/\b(m\.|message|contact|name)\b(?!_)/.test(code), `${f}: a log line mentions form data: ${m[1]}`)
    }
  }
  const cf = src('lib/contactForm.ts')
  assert.match(cf, /meta: \{ kind: m\.kind \}/, 'the activity row carries the kind only')
  const adm = src('app/api/admin/contact-messages/route.ts')
  assert.ok(adm.indexOf("audit('contact_message.reveal'") < adm.indexOf('return NextResponse.json({ contact:'), 'Show is logged before the value is returned')
})

test('A.2 /contact is linked from the footer, Help & Support, FAQ and the pages sitemap', () => {
  assert.match(src('components/Footer.tsx'), /href="\/contact"/)
  assert.match(src('app/(site)/support/page.tsx'), /href="\/contact"/)
  assert.match(src('lib/faqContent.ts'), /href: '\/contact'/)
  assert.match(src('lib/sitemaps.ts'), /\$\{BASE\}\/contact/)
  const page = src('app/(site)/contact/page.tsx')
  assert.match(page, /export const revalidate = 86400/, 'static page')
  assert.ok(!/cookies\(|headers\(/.test(page), 'no per-request read')
  assert.match(page, /waLinkCore|whatsappHref/, 'WhatsApp link from the one helper')
  assert.ok(!/wa\.me\/|api\.whatsapp\.com/.test(page))
})

test('A.3 the Google profile: /contact buttons, footer icon, About link, sameAs', () => {
  const url = 'https://www.google.com/maps?cid=5971264103239707525'
  assert.equal(googleBusinessUrl(), url)
  assert.ok(socialProfiles().includes(url))
  const page = src('app/(site)/contact/page.tsx')
  assert.match(page, /Find us on Google/)
  assert.match(page, /Leave us a review on Google/)
  const footer = src('components/Footer.tsx')
  assert.match(footer, /name: 'Google', icon: '\/google\.png'/)
  assert.ok(statSync('public/google.png').size > 1000)
  assert.match(src('app/(site)/about/page.tsx'), /Find us on Google/)
})

test('A.3 Organization structured data is valid and has no street address', () => {
  const company = { legalName: 'Tutor Mint (Private) Limited', shortName: 'Tutor Mint (Pvt) Ltd', brand: 'TutorMint', address: PUBLIC_LOCATION, email: 'support@tutormint.org', regNo: '{{COMPANY_REG_NO}}', ntn: '{{COMPANY_NTN}}', regNoPending: true, ntnPending: true }
  const org = organizationJsonLd(company, '923215872222') as Record<string, unknown>
  const json = JSON.parse(JSON.stringify(org)) as Record<string, any>
  assert.equal(json['@context'], 'https://schema.org')
  assert.equal(json['@type'], 'Organization')
  assert.equal(json.name, 'TutorMint')
  assert.equal(json.legalName, 'Tutor Mint (Pvt) Limited')
  assert.equal(json.url, 'https://www.tutormint.org')
  assert.ok(String(json.logo?.url).startsWith('https://www.tutormint.org/'))
  assert.deepEqual(json.areaServed, { '@type': 'Country', name: 'Pakistan' })
  assert.deepEqual(json.address, { '@type': 'PostalAddress', addressLocality: 'Lahore', addressCountry: 'PK' })
  assert.ok(json.sameAs.includes('https://www.google.com/maps?cid=5971264103239707525'))
  assert.equal(json.contactPoint['@type'], 'ContactPoint')
  assert.equal(json.contactPoint.contactType, 'customer support')
  assert.ok(json.contactPoint.telephone && json.contactPoint.email)
  assert.ok(!('identifier' in json), 'a placeholder registration number is never published')
})

test('A.4 no street address anywhere in shipped code; the footer shows Lahore', () => {
  const STREET = /Civic Cent(?:er|re)|37-M\b|4th Floor/i
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      if (n === 'node_modules' || n.startsWith('.')) return []
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|txt|md)$/.test(n) ? [p] : []
    })
  for (const f of [...walk('app'), ...walk('components'), ...walk('lib')]) assert.ok(!STREET.test(src(f)), `${f} has a street address`)
  assert.equal(PUBLIC_LOCATION, 'Lahore')
  const footer = src('components/Footer.tsx')
  assert.ok(!footer.includes('Lahore, Pakistan'))
  assert.match(footer, /\{PUBLIC_LOCATION\}/)
  assert.match(footer, /Tutor Mint \(Pvt\) Ltd\. All rights reserved/)
})

// ─────────────────────────────────────────────── PART B — blog editor ──

test('B.2 class / grade numbers are never flagged (the exact phrases)', () => {
  const phrases = ['Class 4', 'class 1 or class 2', 'classes 6 to 10', 'Grade 9–10', 'O Level is a 2-year course', 'A Level takes 2 years', 'Year 1 of A Level', 'Grades 6-8', '9th class', 'AS and A2']
  for (const p of phrases) assert.deepEqual(unsupportedFigures(`Tutors help with ${p} every week.`, 'notes', '', []), [], p)
  // A real figure next to a level is still flagged.
  assert.deepEqual(unsupportedFigures('Class 4 has 300 students and 85% pass.', 'notes', '', []), ['300', '85'])
  assert.deepEqual(unsupportedFigures('Classes 6 to 10 cost 12,000 a month.', 'notes', '', []), ['12,000'])
})

test('B.1 Fix it with AI: one sentence, the figure gone, Keep / Undo', () => {
  const body = 'Intro line here.\n\nMost tutors in Lahore charge about 15,000 a month. Class 4 is easy. Book a demo first.'
  assert.equal(figureGate(body, 'notes', 't').untraced[0], '15,000')
  const s = sentenceWithFigure(body, '15,000')
  assert.equal(s, 'Most tutors in Lahore charge about 15,000 a month.')
  assert.equal(sentenceWithFigure(body, '4'), null, 'a class number is never the flagged sentence')
  const p = figureFixProblem(s!, '15,000')
  assert.equal(p.kind, 'figure')
  assert.equal(p.match, s)
  // An answer that keeps the number, or edits another sentence, is refused.
  assert.equal(figureRewrite(s!, '15,000', [{ field: 'body', before: s!, after: 'Tutors charge 15000 a month.' }]), null)
  assert.equal(figureRewrite(s!, '15,000', [{ field: 'body', before: 'Book a demo first.', after: 'Book now.' }]), null)
  const ok = figureRewrite(s!, '15,000', [{ field: 'body', before: 'about 15,000 a month', after: 'a fee agreed with the family' }])
  assert.ok(ok && !mentionsFigure(ok.after, '15,000'))
  const applied = applyFigureRewrite(body, ok!)
  assert.ok(applied.includes('a fee agreed with the family') && !applied.includes('15,000'))
  assert.equal(undoFigureRewrite(applied, ok!), body, 'Undo restores the sentence exactly')
})

test('B.1 the figure checker has ONE new button; the source field is unchanged', () => {
  const ed = src('components/admin/blog/PostEditor.tsx')
  assert.equal(ed.split('Fix it with AI').length - 1, 1, 'exactly one "Fix it with AI"')
  assert.match(ed, /placeholder="Source for this figure…"/)
  assert.match(ed, /onClick=\{\(\) => confirmFigure\(f\)\}/)
  assert.match(ed, />\s*Keep\s*</)
  assert.match(ed, />\s*Undo\s*</)
})

test('B.3 auto settings from the title', () => {
  const cities = ['Lahore', 'Karachi', 'Islamabad']
  const subjects = ['Physics', 'Mathematics', 'English', 'Islamiat']
  const a = inferSettings({ title: 'How much does an O Level Physics tutor cost in Lahore?', cities, subjects })
  assert.deepEqual([a.city, a.subject, a.cluster, a.language], ['Lahore', 'Physics', 'cost-hiring', 'en'])
  const b = inferSettings({ title: 'How to become a tutor and get more students', cities, subjects })
  assert.equal(b.audience, 'tutors')
  assert.equal(b.cluster, 'tutor-career')
  const c = inferSettings({ title: 'Apne bachon ke liye behtar tutor kaise dhoondein', cities, subjects })
  assert.equal(c.language, 'ur')
  assert.equal(c.cluster, 'urdu')
  const d = inferSettings({ title: 'Choosing a tutor for your child', cities, subjects })
  assert.equal(d.audience, 'parents')
  // The body fills what the title does not say (named at least twice).
  const e = inferSettings({ title: 'A guide to home tuition', body: 'In Karachi many parents… Karachi families…', cities, subjects })
  assert.equal(e.city, 'Karachi')
})

test('B.3 related pages only on a true match; a Pakistan-wide post gets none', () => {
  const pages = [
    { path: 'tutors/lahore/o-level-physics', city: 'Lahore', level: 'O Level', subject: 'Physics', count: 5 },
    { path: 'tutors/lahore/grade-4-english', city: 'Lahore', level: 'Grade 4', subject: 'English', count: 9 },
    { path: 'tutors/karachi/o-level-physics', city: 'Karachi', level: 'O Level', subject: 'Physics', count: 7 },
  ]
  assert.deepEqual(autoRelatedPaths(postTopic({ city: 'Lahore', subject: 'Physics', title: 'O Level Physics' }), pages), ['tutors/lahore/o-level-physics'])
  assert.deepEqual(autoRelatedPaths(postTopic({ city: '', subject: 'Physics', title: 'O Level Physics' }), pages), [], 'no city → none')
  assert.deepEqual(autoRelatedPaths(postTopic({ city: 'Lahore', subject: '', title: 'Tutors in Lahore' }), pages), [], 'city only → none')
})

test('B.3 a field set by hand is never overwritten; cover alt is a plain description', () => {
  const cur = { cluster: 'safety-trust', audience: 'both' as const, language: 'en' as const, city: 'Karachi', subject: '', related: ['x'], coverAlt: 'IMG_2041.jpg' }
  const input = { title: 'O Level Physics tutor fees in Lahore', cities: ['Lahore', 'Karachi'], subjects: ['Physics'], landing: [] }
  const auto = applyAuto(cur, [], input)
  assert.equal(auto.city, 'Lahore')
  assert.equal(auto.cluster, 'cost-hiring')
  assert.deepEqual(auto.related, [])
  assert.ok(auto.coverAlt && !/\.jpg/i.test(auto.coverAlt) && auto.coverAlt.includes('O Level Physics tutor fees in Lahore'))
  const hand = applyAuto(cur, ['city', 'cluster', 'related', 'coverAlt'], input)
  assert.equal(hand.city, 'Karachi')
  assert.equal(hand.cluster, 'safety-trust')
  assert.deepEqual(hand.related, ['x'])
  assert.equal(hand.coverAlt, 'IMG_2041.jpg')
  assert.ok(replaceableAlt('photo.png') && !replaceableAlt('Two students at a desk'))
  assert.equal(autoCoverAlt({ title: '' }), '')
  const route = src('app/api/admin/blog/route.ts')
  assert.match(route, /hand_set:/, 'the flags are stored on the post')
  assert.match(src('supabase/migrations/246_pr20_contact_messages_blog_hand_set.sql'), /add column if not exists hand_set text\[\]/)
})

test('B.4 live job cards: at most 3, matches first, fewer shown as they are, none → newest', () => {
  assert.equal(LIVE_JOBS_LIMIT, 3)
  const j = (id: string) => ({ id })
  assert.deepEqual(chooseLiveJobs([[j('a'), j('b')], [j('b'), j('c'), j('d')]], [j('n1')]).jobs.map((x) => x.id), ['a', 'b', 'c'])
  assert.deepEqual(chooseLiveJobs([[j('a')]], [j('n1'), j('n2')]).jobs.map((x) => x.id), ['a'], 'one match → one card, not padded')
  const none = chooseLiveJobs([], [j('n1'), j('n2'), j('n3'), j('n4')])
  assert.deepEqual(none.jobs.map((x) => x.id), ['n1', 'n2', 'n3'])
  assert.equal(none.matched, false)
  assert.equal(compactLevelSubjectLine('Grade 9', ['Physics', 'Chemistry', 'Biology', 'Maths']), 'Grade 9 · Physics, Chemistry +2')
  assert.equal(compactJobTitle({ headline: null, title: 'Home Tutor | Female | Physics | Lahore' }), 'Home Tutor')
  const block = src('components/blog/OpenTuitionsBlock.tsx')
  assert.match(block, /<CompactJobCard/)
  assert.ok(!/<JobCard\b/.test(block), 'no full job cards in posts')
  const card = src('components/blog/CompactJobCard.tsx')
  assert.ok(!/description|SubjectChips|grade_groups/.test(card.replace(/\/\/[^\n]*/g, '')), 'no descriptions or chip grids')
  assert.match(card, />\s*View\s*</)
})

test('B.5 the blog post has the breadcrumb and no "Back to Blog"', () => {
  const page = src('app/(site)/blog/[slug]/page.tsx')
  assert.match(page, /items=\{\[\{ label: 'Blog', href: '\/blog' \}, \{ label: post\.title \}\]\} showBack=\{false\}/)
})

// ─────────────────────────────────────────────── PART C — images ──

const W = 1000
const H = 1000
const word = (text: string, x: number, y = 100) => ({ text, box: { x0: x, y0: y, x1: x + 60, y1: y + 30 } })

test('C.2 the mask plan: split numbers, look-alike letters, contact lines, emails', () => {
  const lines: OcrLine[] = [
    { words: [word('WhatsApp:', 0), word('0300', 100), word('-', 170), word('1234567', 200)] },
    { words: [word('Fee', 0, 200), word('15000', 100, 200)] },
    { words: [word('Call', 0, 300), word('O3OO', 100, 300), word('l234567', 200, 300)] },
    { words: [word('Email:', 0, 400), word('hr@school.example.com', 100, 400)] },
    { words: [word('Classes', 0, 500), word('6', 100, 500), word('to', 140, 500), word('10', 180, 500)] },
  ]
  const plan = planMask(lines, W, H)
  assert.deepEqual(plan.mobiles, [INVENTED_MOBILE])
  const masked = (y: number) => plan.boxes.filter((b) => b.y0 <= y + 15 && b.y1 >= y + 15).length
  assert.ok(masked(100) >= 2, 'the split number is masked')
  assert.equal(masked(200), 0, 'a fee on its own line stays')
  assert.ok(masked(300) >= 2, 'O/l look-alikes are read as digits and masked')
  assert.ok(masked(400) >= 1, 'the email is masked')
  assert.equal(masked(500), 0, 'class numbers stay')
  assert.equal(digitLookalikes('O321'), '0321')
  assert.equal(digitLookalikes('School'), 'School')
  assert.ok(numberLeft(lines))
  assert.ok(!numberLeft([lines[1], lines[4]]))
  assert.ok(plan.boxes.every((b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H))
  assert.ok(imageTypeOk('image/png') && imageTypeOk('image/webp') && !imageTypeOk('image/gif') && !imageTypeOk('application/pdf'))
  assert.equal(IMAGE_MAX_BYTES, 8 * 1024 * 1024)
})

test('C.2 real OCR on invented images: numbers blacked out before the AI, nothing left to read', async () => {
  const { maskImage } = await import('../lib/imageRead')
  const poster = await maskImage(await hiringPoster())
  assert.ok(poster.ok, 'the "We are hiring" poster masks safely')
  if (poster.ok) {
    assert.deepEqual(poster.mobiles, [INVENTED_MOBILE], 'the number goes to the form')
    assert.ok(poster.masked >= 1)
    assert.ok(!hasNumberLeft(poster.text) && !/1234567/.test(poster.text))
    assert.match(poster.text, /Geography/)
    assert.match(poster.text, /Township/)
    // Read the masked image once more: no number survives.
    const again = await maskImage(poster.jpeg)
    assert.ok(again.ok && again.mobiles.length === 0 && again.masked === 0, 'the masked image has no readable number')
  }
  const shot = await maskImage(await screenshotPost())
  assert.ok(shot.ok && shot.mobiles[0] === INVENTED_MOBILE && /15000/.test(shot.text), 'the fee survives, the number does not')
  const urdu = await maskImage(await urduDigitsPoster())
  assert.ok(urdu.ok && urdu.masked >= 1 && !/[۰-۹٠-٩]/.test(urdu.text), 'a number in Urdu digits on a رابطہ line is masked')
  // The Urdu model alone never masks an English poster's words (it invents digits there).
  assert.deepEqual(urduContactLines([{ words: [{ text: '۳٥١٢٢٢', box: { x0: 0, y0: 0, x1: 9, y1: 9 } }] }]), [])
  assert.equal(asciiDigits('۰۳۰۰'), '0300')
  const none = await maskImage(await noNumberPoster())
  assert.ok(none.ok && none.mobiles.length === 0 && none.masked === 0)
  const junk = await maskImage(Buffer.from('not an image at all'))
  assert.deepEqual(junk, { ok: false, error: IMAGE_UNSAFE })
})

test('C.2 masking fails → the AI is never called; the AI only ever gets the masked image', async () => {
  const { extractTuitionFromImage } = await import('../lib/imageRead')
  const lists = { jobTitles: ['Home Tutor', 'High School Teacher'], cities: ['Lahore'], tree: { School: { 'Grade 9': ['Geography', 'History'] } } }
  let calls = 0
  const failed = await extractTuitionFromImage(Buffer.from('x'), {
    configured: () => true,
    mask: async () => ({ ok: false, error: IMAGE_UNSAFE }),
    lists: async () => lists,
    complete: async () => {
      calls++
      return { ok: true, text: '{}' }
    },
  })
  assert.deepEqual(failed, { ok: false, status: 422, error: IMAGE_UNSAFE })
  assert.equal(calls, 0)
  const masked = Buffer.from('MASKED-JPEG')
  let sent = ''
  let prompt = ''
  const res = await extractTuitionFromImage(Buffer.from('ORIGINAL'), {
    configured: () => true,
    mask: async () => ({ ok: true, jpeg: masked, text: 'We are hiring Geography Teacher Township Lahore', mobiles: [INVENTED_MOBILE], masked: 2 }),
    lists: async () => lists,
    complete: async (a) => {
      sent = a.image.base64
      prompt = a.prompt
      return { ok: true, text: '{"jobType":"High School Teacher","city":"Lahore","area":"Township","school":"Bright Future Academy"}' }
    },
  })
  assert.equal(sent, masked.toString('base64'), 'only the masked image is sent')
  assert.ok(!prompt.includes('1234567') && !hasNumberLeft(prompt.slice(prompt.indexOf('POST:'))))
  assert.ok(res.ok && res.fill.teachingMode === 'High School Teacher' && res.fill.area === 'Township' && res.mobiles[0] === INVENTED_MOBILE)
})

test('C.3 the image is never stored or logged; same daily cap as Paste a post', async () => {
  const { maskImage } = await import('../lib/imageRead')
  const writes: string[] = []
  const orig = { w: fs.writeFileSync, wa: fs.promises.writeFile, s: fs.createWriteStream }
  ;(fs as { writeFileSync: unknown }).writeFileSync = (p: unknown) => void writes.push(String(p))
  ;(fs.promises as { writeFile: unknown }).writeFile = async (p: unknown) => void writes.push(String(p))
  ;(fs as { createWriteStream: unknown }).createWriteStream = (p: unknown) => {
    writes.push(String(p))
    return orig.s('nul')
  }
  try {
    const r = await maskImage(await screenshotPost())
    assert.ok(r.ok)
  } finally {
    fs.writeFileSync = orig.w
    fs.promises.writeFile = orig.wa
    fs.createWriteStream = orig.s
  }
  assert.deepEqual(writes, [], 'nothing written to disk')
  for (const f of ['lib/imageRead.ts', 'app/api/admin/jobs/ai-extract-image/route.ts']) {
    const s = src(f)
    assert.ok(!/\.storage\b|from\('|writeFile|createWriteStream/.test(s), `${f} stores nothing`)
    for (const m of s.matchAll(/console\.(?:log|warn|error)\(([^\n]*)/g)) assert.ok(!/text|mobiles|jpeg|base64|bytes/.test(m[1]), `${f} logs image data: ${m[1]}`)
  }
  const route = src('app/api/admin/jobs/ai-extract-image/route.ts')
  assert.match(route, /rateLimit\('tuition_ai_fill', gate\.actor\.id\)/, 'the shared counter')
  assert.ok(route.indexOf("rateLimit('tuition_ai_fill'") < route.indexOf('extractTuitionFromImage('))
  assert.match(src('components/forms/PastePostBox.tsx'), /Read from image/)
  assert.match(src('components/forms/PastePostBox.tsx'), /clipboardData/, 'Ctrl+V of a screenshot')
})

test('C.4 contact checks apply: the image number goes into the same form field', () => {
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /onFilled\(j\.fill, mobiles\[0\] \?\? null\)/, 'the same onFilled path as Paste a post (live contact check on the form)')
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      console.log(`✓ ${t.name}`)
    } catch (e) {
      failures++
      console.error(`✗ ${t.name}\n  ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(failures === 0 ? `\nAll ${tests.length} PR-20 checks passed.` : `\n${failures} of ${tests.length} failed.`)
  process.exit(failures === 0 ? 0 : 1)
}
main()
