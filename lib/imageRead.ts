import 'server-only'

// lib/imageRead.ts — "Read from image" on staff Post a tuition (owner, 24 Nov
// 2026 — PR-20 Part C). The server half of lib/imageMaskCore.
//
//   1. The image (PNG / JPG / WebP, ≤ 8 MB) is decoded IN MEMORY with sharp —
//      turned upright, sized for reading. It is never written to disk, storage
//      or a log; a failure logs its reason only.
//   2. Plain OCR (tesseract.js — no AI) reads it three times: in English as it
//      is and inverted (white text on a coloured poster), and in Urdu (Urdu
//      digits — used only on a line naming a contact word such as رابطہ, as the
//      Urdu model invents digits on English text); every number-shaped word is
//      found (imageMaskCore planMask).
//   3. Those boxes are blacked out. The masked image is read AGAIN; if anything
//      number-shaped is still readable the newly found boxes are blacked out
//      and it is read once more. Still something → the AI is NOT called
//      ("Couldn't read this image safely…"). Any error in OCR or masking ends
//      the same way.
//   4. Only the masked image — plus the OCR text with every number redacted
//      again — goes to the AI, which fills the same form as "Paste a post"
//      (lib/aiTuitionExtractCore). The mobile found by OCR goes to the browser
//      for the form, never to the AI.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { completeWithImage, isConfigured } from '@/lib/ai/anthropic'
import { loadAiLists } from '@/lib/aiTuitionExtract'
import { AI_UNAVAILABLE, extractPrompt, mapAiAnswer, parseAiJson, EXTRACT_SYSTEM, type AiFill, type AiLists } from '@/lib/aiTuitionExtractCore'
import { hasNumberLeft, redactForAi } from '@/lib/postRedactCore'
import { IMAGE_UNSAFE, linesText, maskSvg, numberLeft, planMask, urduContactLines, type Box, type OcrLine } from '@/lib/imageMaskCore'

type Worker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>

type Lang = 'eng' | 'urd'
const workers: Partial<Record<Lang, Promise<Worker>>> = {}

/** One OCR worker per language per server instance, kept warm: English, and
 *  Urdu (so a number written in Urdu digits ۰۳۰۰… is found too). The language
 *  data is read from node_modules (@tesseract.js-data/*) — nothing is downloaded. */
async function ocrWorker(lang: Lang): Promise<Worker> {
  if (!workers[lang]) {
    workers[lang] = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker(lang, 1, {
        langPath: join(process.cwd(), 'node_modules', '@tesseract.js-data', lang, '4.0.0_best_int'),
        gzip: true,
        cachePath: tmpdir(),
        cacheMethod: 'none',
      })
    })().catch((e) => {
      delete workers[lang]
      throw e
    })
  }
  return workers[lang]!
}

/** The lines and word boxes OCR reads from a PNG buffer. */
async function readLines(png: Buffer, lang: Lang = 'eng'): Promise<OcrLine[]> {
  const worker = await ocrWorker(lang)
  const { data } = await worker.recognize(png, {}, { blocks: true, text: false })
  const out: OcrLine[] = []
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        out.push({ words: (l.words ?? []).map((w) => ({ text: w.text ?? '', box: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } })) })
      }
    }
  }
  return out
}

/** Read as it is and inverted (English), and as it is in Urdu (contact lines
 *  only): `all` = every set of lines (all are masked), `plain` = the English read (the AI's text hint). */
async function readBoth(img: Buffer): Promise<{ all: OcrLine[]; plain: OcrLine[] }> {
  const grey = await sharp(img).greyscale().png().toBuffer()
  const inverted = await sharp(img).greyscale().negate({ alpha: false }).png().toBuffer()
  const plain = await readLines(grey)
  const inv = await readLines(inverted)
  // The Urdu model invents digits on English text, so only its lines that name
  // a contact word (رابطہ / نمبر / واٹس…) are used — every digit on them is masked.
  const urdu = urduContactLines(await readLines(grey, 'urd'))
  return { all: [...plain, ...inv, ...urdu], plain }
}

async function applyMask(img: Buffer, boxes: Box[], w: number, h: number): Promise<Buffer> {
  if (boxes.length === 0) return img
  return sharp(img)
    .composite([{ input: Buffer.from(maskSvg(boxes, w, h)), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

export type MaskedImage = { ok: true; jpeg: Buffer; text: string; mobiles: string[]; masked: number } | { ok: false; error: string }

/** Steps 1–3: the image with every number blacked out, checked by a second read. */
export async function maskImage(input: Buffer): Promise<MaskedImage> {
  try {
    const meta = await sharp(input).metadata()
    if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) return { ok: false, error: IMAGE_UNSAFE }
    // Upright, at most 2000 px wide/high; small screenshots are enlarged so OCR
    // can read their digits. Alpha flattened onto white.
    const base = sharp(input).rotate().flatten({ background: '#ffffff' })
    const m0 = await base.clone().metadata()
    const longest = Math.max(m0.width ?? 0, m0.height ?? 0)
    if (!longest) return { ok: false, error: IMAGE_UNSAFE }
    const target = longest > 2000 ? 2000 : longest < 1200 ? 1200 : longest
    let img: Buffer = await base.resize({ width: (m0.width ?? 0) >= (m0.height ?? 0) ? target : undefined, height: (m0.height ?? 0) > (m0.width ?? 0) ? target : undefined }).png().toBuffer()
    const meta2 = await sharp(img).metadata()
    const w = meta2.width ?? 0
    const h = meta2.height ?? 0

    const first = await readBoth(img)
    const plan = planMask(first.all, w, h)
    img = await applyMask(img, plan.boxes, w, h)
    let masked = plan.boxes.length

    // The after-check: read the masked image again, at most twice.
    let after = await readBoth(img)
    if (numberLeft(after.all)) {
      const again = planMask(after.all, w, h)
      img = await applyMask(img, again.boxes, w, h)
      masked += again.boxes.length
      for (const mob of again.mobiles) if (!plan.mobiles.includes(mob)) plan.mobiles.push(mob)
      after = await readBoth(img)
      if (numberLeft(after.all)) return { ok: false, error: IMAGE_UNSAFE }
    }

    // The OCR text of the masked image, redacted again — never sent if a number survives.
    const text = redactForAi(linesText(after.plain)).text
    if (hasNumberLeft(text)) return { ok: false, error: IMAGE_UNSAFE }
    const jpeg = await sharp(img).jpeg({ quality: 85 }).toBuffer()
    return { ok: true, jpeg, text, mobiles: plan.mobiles, masked }
  } catch (e) {
    console.warn(`[ai-image] masking failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
    return { ok: false, error: IMAGE_UNSAFE }
  }
}

export const IMAGE_SYSTEM = [
  EXTRACT_SYSTEM,
  'The advert is an IMAGE (a poster or a screenshot). Black boxes hide phone numbers and emails — ignore them.',
  'A school or academy hiring a teacher ("We are hiring", "Teacher required") is a teacher job: pick the matching JOB TYPE (Primary / Middle School / High School / O Levels / A Levels Teacher, Visiting Teacher…), and put the school or academy name in "school".',
].join(' ')

export type ImageExtract = { ok: true; fill: AiFill; mobiles: string[] } | { ok: false; status: number; error: string }

export type ImageDeps = {
  configured: () => boolean
  mask: typeof maskImage
  lists: () => Promise<AiLists>
  complete: typeof completeWithImage
}
const REAL_DEPS: ImageDeps = { configured: isConfigured, mask: maskImage, lists: () => loadAiLists(), complete: completeWithImage }

/** The whole "Read from image": mask, then the AI fills the form. The AI is
 *  called only with the MASKED image, and never when masking failed. (`deps`
 *  is for the tests — scripts/test-pr20.ts.) */
export async function extractTuitionFromImage(input: Buffer, deps: ImageDeps = REAL_DEPS): Promise<ImageExtract> {
  if (!deps.configured()) return { ok: false, status: 503, error: AI_UNAVAILABLE }
  const masked = await deps.mask(input)
  if (!masked.ok) return { ok: false, status: 422, error: masked.error }
  const lists = await deps.lists()
  if (lists.jobTitles.length === 0 || Object.keys(lists.tree).length === 0) return { ok: false, status: 503, error: AI_UNAVAILABLE }
  const prompt = extractPrompt(masked.text ? `(Text read from the image — may contain reading errors)\n${masked.text}` : '(Read the image.)', lists)
  if (hasNumberLeft(prompt.slice(prompt.indexOf('POST:')))) return { ok: false, status: 422, error: IMAGE_UNSAFE }
  const r = await deps.complete({
    system: IMAGE_SYSTEM,
    prompt,
    image: { mediaType: 'image/jpeg', base64: masked.jpeg.toString('base64') },
    maxTokens: 1200,
    timeoutMs: 40_000,
  })
  if (!r.ok) {
    console.warn(`[ai-image] extract failed: ${r.reason.slice(0, 120)}`)
    return { ok: false, status: 503, error: AI_UNAVAILABLE }
  }
  const ai = parseAiJson(r.text)
  if (!ai) return { ok: false, status: 503, error: AI_UNAVAILABLE }
  return { ok: true, fill: mapAiAnswer(ai, lists), mobiles: masked.mobiles }
}
