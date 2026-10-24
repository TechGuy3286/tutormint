/**
 * scripts/test-cv.ts
 *
 * Unit tests for the CV builder's pure halves:
 *   npm run test:cv
 * (The real PDF of every template is rendered by scripts/test-cv-pdf.mts —
 * npm run test:cvpdf — which checks one A4 page and the Urdu face.)
 *
 * Covers (owner, 24 Oct 2026): the subjects grid and "+N more", one experience
 * figure everywhere, phone format, every area shown, fee off by default,
 * the verified footer and ✓ only for verified tutors, a hidden photo never used,
 * Title Case with abbreviations kept and stored data unchanged, the saved
 * accent colour, no CNIC on any CV, Urdu text kept, the photo-URL guard, and
 * the download gate.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  toCvModel,
  cvContactRows,
  cvSections,
  cvTextLines,
  cvModernTextLines,
  cvAllText,
  cvFileName,
  isCvAccent,
  CV_TEMPLATES,
  VERIFIED_FOOTER,
  PLAIN_FOOTER,
  type CvRaw,
} from '../lib/cv/model'
import { cvPhone, displayCase, experiencePhrase, subjectGrid, fitGrid, cvTitleLine, withoutCnic, alignExperience } from '../lib/cv/textRules'
import { canDownloadCv } from '../lib/cv/access'
import CvPreview from '../components/cv/CvPreview'
import { cvRaw, heavyRaw, sparseRaw, BASE } from './cvFixtures'

const AVATAR = `${BASE}/storage/v1/object/public/avatars/ali.jpg`
const raw = (over: Partial<CvRaw> = {}) => cvRaw({ avatarUrl: AVATAR, ...over })
const ALL = { includeContact: true, includeFee: true, includePhoto: true }

// -------------------------------------------------------- subjects grid ---

test('subjects are grouped by level and stream, identical grades merged into ranges', () => {
  const grid = subjectGrid([
    { level: 'Grade 9 - Science', subjects: ['Computer Science', 'ICT'] },
    { level: 'Grade 9 - Arts', subjects: ['Computer Science', 'Economics'] },
    { level: 'Grade 10 - Science', subjects: ['ICT', 'Computer Science'] },
    { level: 'Grade 10 - Arts', subjects: ['Computer Science', 'Economics'] },
    { level: 'Grade 1', subjects: ['English'] },
    { level: 'Grade 2', subjects: ['English'] },
    { level: 'Grade 3', subjects: ['English'] },
    { level: 'Grade 5', subjects: ['English'] },
    { level: 'O Levels', subjects: ['Physics'] },
  ])
  assert.deepEqual(grid, [
    { label: 'Grade 1–3', subjects: ['English'] },
    { label: 'Grade 5', subjects: ['English'] },
    { label: 'Grade 9–10 · Arts', subjects: ['Computer Science', 'Economics'] },
    { label: 'Grade 9–10 · Science', subjects: ['Computer Science', 'ICT'] },
    { label: 'O Level', subjects: ['Physics'] },
  ])
})

test('different subjects keep grades apart; legacy "Grade 9 & 10" reads as a range', () => {
  const grid = subjectGrid([
    { level: 'Grade 6', subjects: ['Maths'] },
    { level: 'Grade 7', subjects: ['Maths', 'Science'] },
    { level: 'Grade 9 & 10 - Science', subjects: ['Physics'] },
  ])
  assert.deepEqual(grid.map((c) => c.label), ['Grade 6', 'Grade 7', 'Grade 9–10 · Science'])
})

test('a grid cut to fit ends with "+N more on my profile", N = subjects shown nowhere', () => {
  const cells = subjectGrid(heavyRaw().subjectGroups)
  const fitted = fitGrid(cells, 3, 2)
  assert.equal(fitted.cells.length, 3)
  assert.ok(fitted.cells.every((c) => c.subjects.length <= 2))
  const shown = new Set(fitted.cells.flatMap((c) => c.subjects))
  const all = new Set(cells.flatMap((c) => c.subjects))
  assert.equal(fitted.more, [...all].filter((s) => !shown.has(s)).length)
  const m = toCvModel(heavyRaw(), { ...ALL, template: 'modern' })
  assert.match(m.subjectsMore ?? '', /^\+\d+ more on my profile$/)
  assert.ok(cvModernTextLines(m).includes(m.subjectsMore!))
  // Nothing cut → no line.
  assert.equal(toCvModel(raw(), ALL).subjectsMore, null)
})

// ------------------------------------------------------------ experience ---

test('one experience figure: About and Experience/Teaching always agree', () => {
  for (const years of [1, 3, 5, 10]) {
    const m = toCvModel(raw({ experienceYears: years, bio: 'I teach well. I have 3–5 years of teaching experience.' }), ALL)
    const phrase = experiencePhrase(years)!
    const label = phrase.replace(/ of experience$/, '')
    assert.ok(m.about!.includes(label), `About uses ${label}`)
    assert.ok(!/3–5 years/.test(m.about!) || years === 3)
    assert.equal(m.experience, phrase)
    assert.ok(cvTextLines(m).includes(phrase))
    assert.ok(cvModernTextLines(m).includes(phrase))
  }
  // The owner's case: band 5–10 → never "5 years" in one place and "5–10" in another.
  const m = toCvModel(raw({ experienceYears: 5, bio: 'I have 5–10 years of teaching experience.' }), ALL)
  assert.equal(m.experience, '5–10 years of experience')
  assert.ok(!cvTextLines(m).some((l) => /\b5 years\b/.test(l)))
  // "over 10 years" in the bio reads the same as the Teaching line.
  assert.equal(alignExperience('Backed by over 10 years of experience.', 10), 'Backed by 10+ years of experience.')
  // A number in a sentence about something else is left alone.
  assert.equal(alignExperience('My students are 12 years old.', 5), 'My students are 12 years old.')
  assert.equal(toCvModel(raw({ experienceYears: null }), ALL).experience, null)
})

// ----------------------------------------------------------------- phone ---

test('phones read 0321 1234567, never 92…; WhatsApp only when the profile has it', () => {
  assert.equal(cvPhone('923211234567'), '0321 1234567')
  assert.equal(cvPhone('+92 321 1234567'), '0321 1234567')
  assert.equal(cvPhone('03211234567'), '0321 1234567')
  const both = toCvModel(raw({ phone: '923211234567', whatsapp: '923211234567' }), ALL)
  assert.deepEqual(cvContactRows(both.contact)[0], { kind: 'whatsapp', label: 'Phone & WhatsApp', value: '0321 1234567' })
  const noWa = toCvModel(raw({ phone: '923211234567', whatsapp: null }), ALL)
  const rows = cvContactRows(noWa.contact)
  assert.deepEqual(rows[0], { kind: 'phone', label: 'Phone', value: '0321 1234567' })
  assert.ok(!rows.some((r) => r.kind === 'whatsapp'))
  for (const t of CV_TEMPLATES) {
    assert.ok(!cvAllText(toCvModel(raw({ phone: '923211234567', whatsapp: '923331234567' }), { ...ALL, template: t }), t).some((l) => /\b92\d{10}\b/.test(l)))
  }
})

// ----------------------------------------------------------------- areas ---

test('every area the tutor chose is shown, the same in About and Teaching', () => {
  const r = raw({
    areas: [
      { area: 'DHA Lahore', city: 'Lahore' },
      { area: 'Bahria Town', city: 'Lahore' },
      { area: 'Cantt', city: 'Lahore' },
    ],
    bio: 'I teach in DHA, Bahria Town and Cantt, Lahore.',
  })
  const m = toCvModel(r, ALL)
  assert.deepEqual(m.areas, ['DHA', 'Bahria Town', 'Cantt'])
  assert.equal(m.location, 'DHA, Bahria Town, Cantt, Lahore')
  const modern = cvModernTextLines(toCvModel(r, { ...ALL, template: 'modern' }))
  for (const a of ['DHA', 'Bahria Town', 'Cantt']) assert.ok(modern.includes(a))
  // With no tutor_areas rows, the single legacy area is still shown.
  assert.deepEqual(toCvModel(raw({ areas: [], area: 'Gulberg' }), ALL).areas, ['Gulberg'])
})

// ------------------------------------------------------------------- fee ---

test('the fee is hidden by default and when unticked', () => {
  const byDefault = toCvModel(raw(), { includeContact: true })
  assert.equal(byDefault.feeLabel, null)
  const off = toCvModel(raw(), { includeContact: true, includeFee: false })
  for (const t of CV_TEMPLATES) {
    const m = toCvModel(raw(), { includeContact: true, includeFee: false, template: t })
    assert.ok(!cvAllText(m, t).some((l) => /Rs\s?[\d,]|\/ month/.test(l)), `${t} shows no fee`)
  }
  assert.equal(off.feeLabel, null)
  assert.match(toCvModel(raw(), { includeContact: true, includeFee: true }).feeLabel ?? '', /Rs/)
})

// -------------------------------------------------------- verified footer ---

test('"Verified tutor on TutorMint" and the ✓ only for verified tutors', () => {
  const v = toCvModel(raw({ verified: true }), ALL)
  const u = toCvModel(raw({ verified: false }), ALL)
  const missing = toCvModel(raw({ verified: undefined }), ALL)
  assert.equal(v.footer, VERIFIED_FOOTER)
  assert.equal(u.footer, PLAIN_FOOTER)
  assert.equal(missing.footer, PLAIN_FOOTER)
  assert.equal(v.verified, true)
  assert.equal(u.verified, false)
  for (const t of CV_TEMPLATES) {
    const html = renderToStaticMarkup(createElement(CvPreview, { model: toCvModel(raw({ verified: false }), { ...ALL, template: t }), template: t, qrDataUrl: 'data:,' }))
    assert.ok(!html.includes('Verified tutor on TutorMint'), `${t} unverified: no verified footer`)
    assert.ok(!html.includes('aria-label="Verified"'), `${t} unverified: no ✓`)
    const vh = renderToStaticMarkup(createElement(CvPreview, { model: toCvModel(raw(), { ...ALL, template: t }), template: t, qrDataUrl: 'data:,' }))
    assert.ok(vh.includes('aria-label="Verified"'), `${t} verified: ✓ shown`)
  }
  // The PDF draws the ✓ only inside `model.verified ?`.
  assert.match(readFileSync('lib/cv/pdfDocument.tsx', 'utf8'), /\{model\.verified \? \(/)
})

// ----------------------------------------------------------------- photo ---

test('a hidden photo is never used — the grey silhouette for the gender instead', () => {
  const m = toCvModel(raw({ photoHidden: true, avatarUrl: AVATAR, gender: 'female' }), ALL)
  assert.deepEqual(m.photo, { kind: 'silhouette', avatar: 'female' })
  assert.equal(m.photoUrl, null)
  for (const t of CV_TEMPLATES) {
    const html = renderToStaticMarkup(createElement(CvPreview, { model: toCvModel(raw({ photoHidden: true, gender: 'male' }), { ...ALL, template: t }), template: t, qrDataUrl: 'data:,' }))
    assert.ok(!html.includes(AVATAR), `${t}: the hidden photo URL is not in the page`)
    assert.ok(html.includes('/avatars/male.svg'))
  }
  // No photo on file → silhouette too; "Include photo" off → no picture at all.
  assert.deepEqual(toCvModel(raw({ avatarUrl: null, gender: null }), ALL).photo, { kind: 'silhouette', avatar: 'neutral' })
  assert.equal(toCvModel(raw(), { ...ALL, includePhoto: false }).photo, null)
  // The download route fetches the photo only when it is a real, shown photo.
  assert.match(readFileSync('app/api/tutor/cv/pdf/route.tsx', 'utf8'), /model\.photo\?\.kind === 'photo' \? fetchImageDataUri\(model\.photo\.url\)/)
})

test('the photo is an avatar or nothing — identity-docs and foreign URLs are rejected', () => {
  assert.equal(toCvModel(raw(), ALL).photoUrl, AVATAR)
  for (const bad of [
    `${BASE}/storage/v1/object/public/identity-docs/cnic-front.jpg`,
    `${BASE}/storage/v1/object/sign/identity-docs/selfie.jpg`,
    'data:image/png;base64,iVBORw0KG',
    'https://evil.example.com/me.jpg',
  ]) {
    const m = toCvModel(raw({ avatarUrl: bad }), ALL)
    assert.equal(m.photoUrl, null)
    assert.equal(m.photo?.kind, 'silhouette')
  }
})

// ------------------------------------------------------------ Title Case ---

test('capitals become Title Case, abbreviations kept, stored data unchanged', () => {
  assert.equal(displayCase('BS COMPUTER SCIENCE'), 'BS Computer Science')
  assert.equal(displayCase('BS COMPUTER SCIENCE — UNIVERSITY OF THE PUNJAB (2015)'), 'BS Computer Science — University of the Punjab (2015)')
  assert.equal(displayCase('M.PHIL EDUCATION'), 'M.Phil Education')
  assert.equal(displayCase('MSC PHYSICS, LUMS'), 'MSc Physics, LUMS')
  assert.equal(displayCase('PHD MATHEMATICS'), 'PhD Mathematics')
  assert.equal(displayCase('FSC PRE-MEDICAL'), 'FSc Pre-Medical')
  assert.equal(displayCase('O LEVELS AND A LEVELS'), 'O Levels and A Levels')
  assert.equal(displayCase('ICS WITH ICT AND CS'), 'ICS with ICT and CS')
  assert.equal(displayCase('MBA, BA, MA'), 'MBA, BA, MA')
  // Text with lower-case letters is the tutor's own casing — untouched.
  assert.equal(displayCase('BSc Physics — LUMS'), 'BSc Physics — LUMS')
  const r = raw({ degrees: ['BS COMPUTER SCIENCE'] })
  const before = JSON.stringify(r)
  const m = toCvModel(r, ALL)
  assert.deepEqual(m.degrees, ['BS Computer Science'])
  assert.equal(JSON.stringify(r), before, 'the stored profile value is not changed')
})

// ---------------------------------------------------------------- accent ---

test('the accent colour is saved per tutor and read back', () => {
  assert.equal(isCvAccent('navy') && isCvAccent('green') && isCvAccent('charcoal'), true)
  assert.equal(isCvAccent('pink'), false)
  const prefs = readFileSync('app/api/tutor/cv/prefs/route.ts', 'utf8')
  assert.match(prefs, /\.update\(\{ cv_accent: accent \}\)\.eq\('id', user\.id\)/, 'writes only cv_accent on the signed-in tutor')
  assert.match(prefs, /isCvAccent\(accent\)/, 'refuses an unknown colour')
  assert.match(readFileSync('lib/cv/build.ts', 'utf8'), /accent: isCvAccent\(tp\?\.cv_accent\)/, 'the CV page reads it back')
  assert.match(readFileSync('components/cv/CvClient.tsx', 'utf8'), /useState<CvAccent>\(raw\.accent \?\? DEFAULT_ACCENT\)/, 'the page opens on the saved colour')
  assert.match(readFileSync('supabase/migrations/199_cv_accent.sql', 'utf8'), /check \(cv_accent is null or cv_accent in \('navy', 'green', 'charcoal'\)\)/)
})

// ------------------------------------------------------------------ CNIC ---

test('no CNIC number on any CV', () => {
  const r = raw({ bio: 'My CNIC is 35202-1234567-1 and 3520212345671.', degrees: ['BSc 35202-1234567-1'] })
  assert.equal(withoutCnic('CNIC 35202-1234567-1 here'), 'CNIC here')
  for (const t of CV_TEMPLATES) {
    const lines = cvAllText(toCvModel(r, { ...ALL, template: t }), t)
    assert.ok(!lines.some((l) => /\d{5}-?\d{7}-?\d/.test(l)), `${t} shows no CNIC`)
  }
  // The CV never reads the CNIC columns.
  assert.doesNotMatch(readFileSync('lib/cv/build.ts', 'utf8'), /cnic/i)
})

// ------------------------------------------------------------------ Urdu ---

test('Urdu profile text is kept as written (the PDF draws it with the Urdu face)', () => {
  const urdu = 'میں طلبہ کو ریاضی پڑھاتی ہوں'
  const m = toCvModel(raw({ bio: urdu }), ALL)
  assert.equal(m.about, urdu)
  const pdf = readFileSync('lib/cv/pdfDocument.tsx', 'utf8')
  assert.match(pdf, /const FONTS = \['Jakarta', 'Naskh'\]/)
  assert.match(readFileSync('lib/cv/urduFont.ts', 'utf8'), /NASKH_400_B64 =\n  'd09G/)
})

// -------------------------------------------------------------- title line ---

test('the title line is "<subjects> tutor · <City>", cut at a whole word', () => {
  assert.equal(cvTitleLine(['Physics'], 'Lahore'), 'Physics tutor · Lahore')
  assert.equal(cvTitleLine(['Physics', 'Maths'], 'Lahore'), 'Physics & Maths tutor · Lahore')
  assert.equal(cvTitleLine(['Physics', 'Maths', 'Urdu'], 'Lahore'), 'Physics, Maths & more tutor · Lahore')
  const long = cvTitleLine(['Translation of the Holy Quran with Tajweed and Tafseer for adults'], 'Rawalpindi', 50)
  assert.ok(long.length <= 50 && long.endsWith(' tutor · Rawalpindi'))
  assert.equal(cvTitleLine([], 'Lahore'), 'Tutor · Lahore')
})

// --------------------------------------------- preview == shared text ---

function squash(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[\s:]+/g, '')
}

test('the preview renders exactly the shared text, in order, for every template', () => {
  for (const t of CV_TEMPLATES) {
    for (const r of [heavyRaw({ avatarUrl: AVATAR }), sparseRaw(), raw()]) {
      const model = toCvModel(r, { ...ALL, template: t })
      const text = squash(renderToStaticMarkup(createElement(CvPreview, { model, template: t, qrDataUrl: 'data:,' })))
      let cursor = 0
      for (const line of cvAllText(model, t)) {
        const needle = squash(line)
        const at = text.indexOf(needle, cursor)
        assert.ok(at >= cursor, `${t}: preview missing or out of order: "${line}"`)
        cursor = at + needle.length
      }
    }
  }
})

test('cvSections omits empty sections', () => {
  const model = toCvModel(sparseRaw(), { includeContact: true })
  assert.deepEqual(cvSections(model).map((s) => s.key), ['subjects', 'teaching'])
})

test('the PDF file name is "<Name>-TutorMint-CV.pdf"', () => {
  assert.equal(cvFileName('Ali Raza'), 'Ali-Raza-TutorMint-CV.pdf')
  assert.equal(cvFileName('  '), 'Tutor-TutorMint-CV.pdf')
  assert.match(readFileSync('app/api/tutor/cv/pdf/route.tsx', 'utf8'), /filename="\$\{cvFileName\(model\.name\)\}"/)
  assert.match(readFileSync('components/cv/CvClient.tsx', 'utf8'), /a\.download = cvFileName\(model\.name\)/)
})

test('Modern is the default template, Classic and Minimal stay', () => {
  assert.deepEqual(CV_TEMPLATES, ['modern', 'classic', 'minimal'])
  assert.match(readFileSync('components/cv/CvClient.tsx', 'utf8'), /useState<CvTemplate>\('modern'\)/)
  assert.match(readFileSync('app/api/tutor/cv/pdf/route.tsx', 'utf8'), /: 'modern'/)
})

// --------------------------------------------------------------- the gate ---

test('an unverified tutor (no plan) cannot download; every plan tier can', () => {
  assert.equal(canDownloadCv({ audience: 'tutor', plan: null, suspended: false }), false)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'basic', suspended: false }), true)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'premium', suspended: false }), true)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'featured', suspended: false }), true)
})

test('a suspended tutor and a parent cannot download', () => {
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'featured', suspended: true }), false)
  assert.equal(canDownloadCv({ audience: 'parent', plan: 'parent_featured', suspended: false }), false)
})
