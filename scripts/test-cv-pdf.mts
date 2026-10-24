/**
 * scripts/test-cv-pdf.mts — renders the real CV PDF for every template.
 *   npm run test:cvpdf
 *
 * An .mts file so it runs as ES modules: @react-pdf/renderer cannot be loaded
 * from CommonJS (its hyphenate dependency has no require export), so this file
 * imports react-pdf itself and hands it to lib/cv/pdfDocument.tsx.
 *
 * Checks:
 *   - every template, in every colour, fits ONE A4 page with a very long name,
 *     20 subjects, a long About and many areas (react-pdf flows an overflow
 *     onto a second page, so counting pages catches it);
 *   - the page is A4 (595.28 × 841.89 pt);
 *   - Urdu text in the About is drawn with the Urdu face (Noto Naskh Arabic is
 *     embedded in the PDF) and in Plus Jakarta Sans otherwise.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const R = await import('@react-pdf/renderer')
const { buildCvDocument } = await import('../lib/cv/pdfDocument.tsx')
const { toCvModel, CV_TEMPLATES, CV_ACCENTS } = await import('../lib/cv/model.ts')
const { heavyRaw, sparseRaw, cvRaw } = await import('./cvFixtures.ts')

const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function render(raw: ReturnType<typeof cvRaw>, template: (typeof CV_TEMPLATES)[number], accent: (typeof CV_ACCENTS)[number], opts: { fee?: boolean } = {}) {
  const model = toCvModel(raw, { includeContact: true, includeFee: opts.fee ?? true, includePhoto: true, template })
  const doc = buildCvDocument(R, { model, template, accent, qrDataUri: QR, photoDataUri: null })
  return Buffer.from(await R.renderToBuffer(doc))
}

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length

// Every page is a full A4 sheet, never shrunk to its content.
const A4 = /\/MediaBox\s*\[\s*0 0 595\.2\d* 841\.8\d*\s*\]/
function onePageA4(pdf: Buffer) {
  assert.equal(pages(pdf), 1)
  assert.match(pdf.toString('latin1'), A4)
}

for (const template of CV_TEMPLATES) {
  for (const accent of CV_ACCENTS) {
    test(`${template} / ${accent}: the heaviest profile fits one A4 page`, async () => {
      const pdf = await render(heavyRaw(), template, accent)
      assert.equal(pages(pdf), 1, `${template} ${accent} ran onto a second page`)
      assert.match(pdf.toString('latin1'), /\/MediaBox\s*\[\s*0 0 595\.2\d* 841\.8\d*\s*\]/)
    })
  }
  test(`${template}: a sparse profile is one page`, async () => {
    onePageA4(await render(sparseRaw(), template, 'navy'))
  })
  test(`${template}: a hidden photo, unverified tutor is one page`, async () => {
    onePageA4(await render(heavyRaw({ photoHidden: true, verified: false, gender: 'female' }), template, 'green'))
  })
}

test('the page counter does see an overflow (so the one-page checks mean something)', async () => {
  const model = toCvModel(heavyRaw(), { includeContact: true, includeFee: true, template: 'modern' })
  model.about = 'A long paragraph of text that keeps going. '.repeat(120)
  const doc = buildCvDocument(R, { model, template: 'modern', accent: 'navy', qrDataUri: QR, photoDataUri: null })
  assert.ok(pages(Buffer.from(await R.renderToBuffer(doc))) >= 2)
})

test('Urdu text is drawn with the embedded Urdu face', async () => {
  const pdf = (await render(cvRaw({ bio: 'میں طلبہ کو آسان طریقے سے ریاضی پڑھاتی ہوں۔ I teach Mathematics.' }), 'modern', 'navy')).toString('latin1')
  assert.match(pdf, /NotoNaskhArabic/, 'the Urdu font is embedded')
  assert.match(pdf, /PlusJakartaSans/, 'the Latin font is embedded')
})

test('an English-only CV does not need the Urdu face', async () => {
  const pdf = (await render(cvRaw(), 'modern', 'navy')).toString('latin1')
  assert.doesNotMatch(pdf, /NotoNaskhArabic/)
})
