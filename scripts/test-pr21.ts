/**
 * scripts/test-pr21.ts — npm run test:pr21
 *
 * PR-21 (owner, 24 Nov 2026 — hotfix): "Read from image" failed every time in
 * production (the OCR worker could not load 'bmp-js' on Vercel and the request
 * hung to its 60 s limit); the Urdu-digit gap in images and pasted text.
 *
 * Real OCR runs on INVENTED images built in memory (scripts/fixtures/pr21Images
 * — 0300 1234567 is made up); the AI is mocked. Reads nothing from production
 * and writes nothing anywhere. After `npm run build`, also checks the built
 * route really carries every file the OCR worker loads.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

import { AI_BUSY, AI_TOO_SLOW, AI_UNAVAILABLE, aiFailureKind, runExtraction, safeReason, type AiLists } from '../lib/aiTuitionExtractCore'
import { asciiDigits, hasNumberLeft, redactForAi } from '../lib/postRedactCore'
import {
  IMAGE_MAX_BYTES,
  IMAGE_PICK_MAX_BYTES,
  IMAGE_TOO_BIG,
  IMAGE_TOO_SLOW,
  IMAGE_WRONG_TYPE,
  numberLeft,
  planMask,
  urduDigitWords,
  URDU_DIGIT_MIN,
  type OcrLine,
} from '../lib/imageMaskCore'
import { gifImage, heicHeader, phonePhotoPoster, urduDigitsNoContactWord } from './fixtures/pr21Images'

const INVENTED_MOBILE = '923001234567'
let failures = 0
const tests: { name: string; fn: () => void | Promise<void> }[] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn })
const src = (p: string) => readFileSync(p, 'utf8')

const LISTS: AiLists = {
  jobTitles: ['Home Tutor', 'Online Tutor', 'High School Teacher', 'Middle School Teacher'],
  cities: ['Karachi', 'Lahore'],
  tree: { School: { 'Grade 9': ['Geography', 'History'], 'Grade 6': ['Mathematics'] } },
}
const AI_ANSWER = '{"jobType":"High School Teacher","mode":"home","city":"Lahore","area":"Township","levels":["Grade 9"],"subjectsByLevel":{"Grade 9":["Geography","History"]}}'

// ─────────────────────────────────── the cause: files the worker loads ──

test('every package the OCR worker require()s ships with the image route', async () => {
  const cfg = (await import('../next.config')).default
  const inc = (cfg.outputFileTracingIncludes as Record<string, string[]>)['/api/admin/jobs/ai-extract-image']
  assert.ok(Array.isArray(inc))
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.js')) files.push(p)
    }
  }
  walk('node_modules/tesseract.js/src')
  const needed = new Set<string>()
  for (const f of files) {
    for (const m of src(f).matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
      const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
      if (!builtinModules.includes(name) && !name.startsWith('node:')) needed.add(name)
    }
  }
  assert.ok(needed.has('bmp-js'), 'the package production could not find')
  for (const n of needed) {
    assert.ok(inc.some((g) => g.includes(`node_modules/${n}/`) || g.includes(`/node_modules/${n}/`)), `${n} is in outputFileTracingIncludes`)
  }
  for (const lang of ['eng', 'urd']) assert.ok(inc.some((g) => g.includes(`@tesseract.js-data/${lang}/`)), `${lang} language data`)
})

test('after a build: the route trace really lists bmp-js, the worker script and the language data', () => {
  const nft = '.next/server/app/api/admin/jobs/ai-extract-image/route.js.nft.json'
  if (!existsSync(nft)) {
    console.log('    (no build output yet — run after npm run build)')
    return
  }
  const traced = (JSON.parse(src(nft)) as { files: string[] }).files.map((f) => f.replace(/\\/g, '/'))
  for (const piece of ['node_modules/bmp-js/', 'node_modules/regenerator-runtime/', 'node_modules/tesseract.js/src/worker-script/node/index.js', 'eng.traineddata.gz', 'urd.traineddata.gz', 'node_modules/tesseract.js-core/']) {
    assert.ok(traced.some((f) => f.includes(piece)), `traced: ${piece}`)
  }
})

test('the route has time for OCR + AI and always answers JSON with a plain message', () => {
  const route = src('app/api/admin/jobs/ai-extract-image/route.ts')
  assert.match(route, /export const maxDuration = 120/)
  const read = src('lib/imageRead.ts')
  const ocr = Number(/OCR_BUDGET_MS = ([\d_]+)/.exec(read)![1].replace(/_/g, ''))
  const ai = Number(/AI_IMAGE_TIMEOUT_MS = ([\d_]+)/.exec(read)![1].replace(/_/g, ''))
  assert.ok(ocr + ai <= 110_000, 'OCR + AI fit inside 120 s with room to answer')
  assert.match(route, /catch \(e\)[\s\S]*refuse\(503, AI_UNAVAILABLE/, 'an unexpected error still answers JSON')
  assert.match(read, /errorHandler/, 'a worker error drops the worker')
  assert.match(read, /withTimeout\(worker\.recognize/, 'a hung read is timed out, never left to the platform limit')
})

// ─────────────────────────────────── end to end on an invented poster ──

test('the Owner\'s poster at phone-photo size: the form filled, the number to the form (PR-22: OCR beside the AI)', async () => {
  const { extractTuitionFromImage, prepareImage, ocrNumbers } = await import('../lib/imageRead')
  let sentImage: Buffer | null = null
  let calls = 0
  const t0 = Date.now()
  const res = await extractTuitionFromImage(await phonePhotoPoster(), {
    configured: () => true,
    prepare: (b) => prepareImage(b),
    ocr: (b) => ocrNumbers(b),
    lists: async () => LISTS,
    complete: async (a) => {
      calls++
      sentImage = Buffer.from(a.image.base64, 'base64')
      assert.equal(a.image.mediaType, 'image/jpeg')
      return { ok: true, text: AI_ANSWER.replace(/}$/, ',"contactPhone":"03001234567"}') }
    },
  })
  const ms = Date.now() - t0
  assert.ok(res.ok, `filled (${res.ok ? '' : res.reason})`)
  assert.equal(calls, 1)
  if (res.ok) {
    assert.deepEqual(res.mobiles, [INVENTED_MOBILE], 'the number goes to the form, in English digits')
    assert.equal(res.number.source, 'both', 'OCR read the same number as the AI')
    assert.equal(res.fill.teachingMode, 'High School Teacher')
    assert.equal(res.fill.city, 'Lahore')
    assert.equal(res.fill.area, 'Township')
  }
  const meta = await (await import('sharp')).default(sentImage!).metadata()
  assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= 1568, 'sized for the AI')
  console.log(`    (local OCR beside the AI: ${ms} ms)`)
})

// ─────────────────────────────────── Urdu digits ──

test('Urdu digits on a line with no contact word are read without error (real OCR)', async () => {
  const { prepareImage, ocrNumbers } = await import('../lib/imageRead')
  const p = await prepareImage(await urduDigitsNoContactWord())
  assert.ok(p.ok)
  if (p.ok) assert.ok((await ocrNumbers(p.img)).ok)
})

const w = (text: string, x: number, y: number, conf?: number) => ({ text, conf, box: { x0: x, y0: y, x1: x + 80, y1: y + 40 } })

test('the Urdu model\'s digits count only away from confident English words', () => {
  const eng: OcrLine[] = [{ words: [w('Township', 0, 0, 92), w('Lahore', 100, 0, 90)] }, { words: [w('~~', 0, 100, 12)] }]
  const urdu: OcrLine[] = [
    { words: [w('۵۱۲', 0, 0), w('۷۷', 100, 0)] }, // invented on top of English words
    { words: [w('۰۳۰۰', 0, 100), w('۱۲۳۴۵۶۷', 90, 100)] }, // a real Urdu-digit number (English read nothing confident)
  ]
  const lines = urduDigitWords(urdu, eng)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].words.length, 2)
  assert.ok(lines[0].urduDigits)
  const plan = planMask(lines, 1000, 1000)
  assert.equal(plan.boxes.length, 2, 'both words found')
  assert.ok(numberLeft(lines))
  assert.ok(!numberLeft([{ words: [w('۱۲', 0, 0)], urduDigits: true }]), 'a stray digit or two is not a number')
  assert.ok(URDU_DIGIT_MIN <= 10, 'a 10-digit run always counts')
  assert.ok(numberLeft([{ words: [w('۰۳۰۰', 0, 0), w('-', 90, 0), w('۱۲۳', 180, 0), w('۴۵۶', 270, 0)], urduDigits: true }]))
})

test('pasted text: Urdu-digit numbers are taken out before the AI and go to the form in English digits', async () => {
  const post = 'Home tutor chahiye Grade 6 Maths, Model Colony Karachi. رابطہ ۰۳۰۰-۱۲۳۴۵۶۷ fee ۱۵۰۰۰'
  const red = redactForAi(post)
  assert.deepEqual(red.mobiles, [INVENTED_MOBILE])
  assert.ok(!/[۰-۹]{4}/.test(red.text) && !red.text.includes('1234567'))
  assert.match(red.text, /15000/, 'a fee stays (in English digits)')
  assert.ok(hasNumberLeft('call ٠٣٠٠١٢٣٤٥٦٧'), 'Arabic-Indic digits too')
  assert.ok(hasNumberLeft('۰۳۰۰ ۱۲۳ ۴۵۶۷'), 'spaces between')
  assert.ok(!hasNumberLeft('fee ۱۵۰۰۰ - ۲۰۰۰۰'), 'a fee range is not a number')
  assert.equal(asciiDigits('۰۳۰۰'), '0300')
  let prompt = ''
  const r = await runExtraction(post, LISTS, async (a) => {
    prompt = a.prompt
    return { ok: true, text: '{"jobType":"Home Tutor","city":"Karachi","area":"Model Colony"}' }
  })
  assert.ok(r.ok)
  assert.ok(!hasNumberLeft(prompt) && !/[۰-۹]{4}/.test(prompt), 'the AI never sees the number')
})

// ─────────────────────────────────── plain messages ──

test('photo type: HEIC / GIF / not a picture → "This photo type isn\'t supported…", the AI never called', async () => {
  const { prepareImage } = await import('../lib/imageRead')
  assert.equal(IMAGE_WRONG_TYPE, "This photo type isn't supported — please use a screenshot (PNG or JPG).")
  for (const buf of [heicHeader(), await gifImage(), Buffer.from('not an image')]) {
    const r = await prepareImage(buf)
    assert.ok(!r.ok && r.kind === 'type' && r.error === IMAGE_WRONG_TYPE, r.ok ? 'ok?' : r.reason)
  }
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /image\/heic/, 'the picker offers phone photos; the browser converts them')
  assert.match(box, /if \(!jpeg\) \{\s*setError\(IMAGE_WRONG_TYPE\)/, 'a photo the browser cannot open says so')
})

test('too large: limits and messages', () => {
  assert.equal(IMAGE_TOO_BIG, 'This image is too large — try a screenshot instead.')
  assert.ok(IMAGE_MAX_BYTES < 4.5 * 1024 * 1024, 'under the request limit')
  assert.ok(IMAGE_PICK_MAX_BYTES >= 20 * 1024 * 1024, 'a phone photo is shrunk, not refused')
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /jpeg\.size > IMAGE_MAX_BYTES/, 'checked after shrinking')
  assert.match(box, /status === 413\) return IMAGE_TOO_BIG/, "the platform's own 413 too")
  assert.match(src('app/api/admin/jobs/ai-extract-image/route.ts'), /refuse\(413, IMAGE_TOO_BIG/)
})

test('timeouts and a busy AI have their own messages', async () => {
  const { extractTuitionFromImage, ocrNumbers, prepareImage } = await import('../lib/imageRead')
  assert.equal(IMAGE_TOO_SLOW, 'Took too long — please try again.')
  assert.equal(AI_BUSY, 'The AI is busy — please try again in a minute.')
  // OCR out of time: a timeout result, never a throw (the AI's number is then used alone — PR-22).
  const p = await prepareImage(await urduDigitsNoContactWord())
  assert.ok(p.ok)
  if (p.ok) {
    const slow = await ocrNumbers(p.img, Date.now() - 1)
    assert.ok(!slow.ok && slow.kind === 'timeout')
  }
  const deps = (reason: string) => ({
    configured: () => true,
    prepare: async () => ({ ok: true as const, img: Buffer.from('PNG'), jpeg: Buffer.from('JPEG') }),
    ocr: async () => ({ ok: true as const, mobiles: [] }),
    lists: async () => LISTS,
    complete: async () => ({ ok: false as const, reason }),
  })
  const t = await extractTuitionFromImage(Buffer.from('x'), deps('timed out after 35000ms'))
  assert.ok(!t.ok && t.status === 504 && t.error === AI_TOO_SLOW)
  const b = await extractTuitionFromImage(Buffer.from('x'), deps('anthropic 529: {"type":"overloaded_error"}'))
  assert.ok(!b.ok && b.status === 503 && b.error === AI_BUSY)
  const o = await extractTuitionFromImage(Buffer.from('x'), deps('anthropic 400: invalid model'))
  assert.ok(!o.ok && o.error === AI_UNAVAILABLE && o.reason.startsWith('ai_other'))
  assert.equal(aiFailureKind('anthropic 429: rate_limit_error'), 'busy')
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /AbortError' \? IMAGE_TOO_SLOW/, 'the browser gives up with the same message')
  assert.match(box, /status === 504 \|\| status === 408\) return IMAGE_TOO_SLOW/)
  assert.match(box, /Reading image…/, 'progress while reading')
})

test('the Owner\'s Audit log gets the technical reason, never content', () => {
  for (const f of ['app/api/admin/jobs/ai-extract-image/route.ts', 'app/api/admin/jobs/ai-extract/route.ts']) {
    const s = src(f)
    assert.match(s, /action: 'tuition\.ai_fill_failed'/, f)
    assert.match(s, /reason: safeReason\(/, f)
    assert.ok(!/detail: \{[^}]*\b(parsed|bytes|base64|mobiles|fill|file)\b/.test(s), `${f}: no content in the audit detail`)
  }
  assert.ok(!/\d{7}/.test(safeReason('anthropic 400: bad 0300 1234567 x@y.example.com')), 'numbers and emails stripped')
  assert.ok(safeReason('x'.repeat(500)).length <= 160)
  assert.match(src('lib/timelineLabelsCore.ts'), /'tuition\.ai_fill_failed'/)
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
  console.log(failures === 0 ? `\nAll ${tests.length} PR-21 checks passed.` : `\n${failures} of ${tests.length} failed.`)
  process.exit(failures === 0 ? 0 : 1)
}
main()
