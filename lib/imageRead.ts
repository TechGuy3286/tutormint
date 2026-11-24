import 'server-only'

// lib/imageRead.ts — "Read from image" on staff Post a tuition (owner, 24 Nov
// 2026 — PR-20 Part C; made to work on Vercel in PR-21). The server half of
// lib/imageMaskCore.
//
//   1. The image (the browser always sends a JPEG ≤ 2000 px; PNG / WebP also
//      read) is decoded IN MEMORY with sharp — turned upright, sized for
//      reading. It is never written to disk, storage or a log; a failure logs
//      its technical reason only.
//   2. Plain OCR (tesseract.js — no AI) reads it: in English as it is and
//      inverted (white text on a coloured poster), and in Urdu. Urdu lines are
//      used where they name a contact word such as رابطہ, and Urdu digits
//      wherever the English model read no confident English word (PR-21 —
//      imageMaskCore urduDigitWords). Every number-shaped word is found
//      (imageMaskCore planMask).
//   3. Those boxes are blacked out. The masked image is read AGAIN; if anything
//      number-shaped is still readable the newly found boxes are blacked out
//      and it is read once more. Still something → the AI is NOT called
//      ("Couldn't read this image safely…"). Any error in OCR or masking ends
//      the same way.
//   4. Only the masked image — plus the OCR text with every number redacted
//      again — goes to the AI, which fills the same form as "Paste a post"
//      (lib/aiTuitionExtractCore). The mobile found by OCR goes to the browser
//      for the form, never to the AI.
//
// Time (PR-21): the route may run 120 s. OCR has 70 s in all and no single OCR
// step may take over 30 s; a step that runs over (or an OCR worker that died —
// PR-21's production failure was a worker that could not load its modules and
// never answered) is dropped and restarted on the next request, and staff see
// "Took too long — please try again." The AI call has 35 s.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { completeWithImage, isConfigured } from '@/lib/ai/anthropic'
import { loadAiLists } from '@/lib/aiTuitionExtract'
import {
  AI_UNAVAILABLE,
  aiFailureKind,
  aiFailureMessage,
  extractPrompt,
  mapAiAnswer,
  parseAiJson,
  safeReason,
  EXTRACT_SYSTEM,
  type AiFill,
  type AiLists,
} from '@/lib/aiTuitionExtractCore'
import { hasNumberLeft, redactForAi } from '@/lib/postRedactCore'
import {
  IMAGE_TOO_SLOW,
  IMAGE_UNSAFE,
  IMAGE_WRONG_TYPE,
  linesText,
  maskSvg,
  numberLeft,
  planMask,
  urduContactLines,
  urduDigitWords,
  type Box,
  type OcrLine,
} from '@/lib/imageMaskCore'

/** All OCR for one image (first read, mask, after-checks). */
export const OCR_BUDGET_MS = 70_000
/** One OCR step (starting a worker, or one read). */
const OCR_STEP_MAX_MS = 30_000
/** The AI call. 70 + 35 s leaves room inside the route's 120 s. */
export const AI_IMAGE_TIMEOUT_MS = 35_000
/** The longest side of the masked image the AI gets (its own preferred size). */
const AI_IMAGE_MAX_PX = 1568

type Worker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>

type Lang = 'eng' | 'urd'
const workers: Partial<Record<Lang, Promise<Worker>>> = {}

class OcrTimeout extends Error {
  constructor(what: string) {
    super(`ocr ${what} timed out`)
  }
}

/** Stop a worker that ran over or failed, so the next read starts a fresh one. */
function dropWorker(lang: Lang) {
  const w = workers[lang]
  delete workers[lang]
  if (w) void w.then((x) => x.terminate()).catch(() => undefined)
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OcrTimeout(what)), Math.max(1, ms))
    }),
  ]).finally(() => clearTimeout(timer))
}

/** One OCR worker per language per server instance, kept warm: English, and
 *  Urdu (so a number written in Urdu digits ۰۳۰۰… is found too). The language
 *  data is read from node_modules (@tesseract.js-data/*) — nothing is
 *  downloaded. Its files ship with the route (next.config.ts
 *  outputFileTracingIncludes — tesseract.js and every package its worker loads). */
async function ocrWorker(lang: Lang): Promise<Worker> {
  if (!workers[lang]) {
    workers[lang] = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker(lang, 1, {
        langPath: join(process.cwd(), 'node_modules', '@tesseract.js-data', lang, '4.0.0_best_int'),
        gzip: true,
        cachePath: tmpdir(),
        cacheMethod: 'none',
        errorHandler: (e: unknown) => {
          console.warn(`[ai-image] ocr worker error: ${safeReason(e instanceof Error ? e.message : String(e))}`)
          dropWorker(lang)
        },
      })
    })().catch((e) => {
      delete workers[lang]
      throw e
    })
  }
  return workers[lang]!
}

/** The lines and word boxes (with confidence) OCR reads from a PNG buffer. */
async function readLines(png: Buffer, lang: Lang, deadline: number): Promise<OcrLine[]> {
  const left = () => Math.min(OCR_STEP_MAX_MS, deadline - Date.now())
  if (left() <= 0) throw new OcrTimeout('budget')
  try {
    const worker = await withTimeout(ocrWorker(lang), left(), `${lang} start`)
    if (left() <= 0) throw new OcrTimeout('budget')
    const { data } = await withTimeout(worker.recognize(png, {}, { blocks: true, text: false }), left(), `${lang} read`)
    const out: OcrLine[] = []
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs ?? []) {
        for (const l of p.lines ?? []) {
          out.push({
            words: (l.words ?? []).map((w) => ({
              text: w.text ?? '',
              conf: w.confidence,
              box: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            })),
          })
        }
      }
    }
    return out
  } catch (e) {
    dropWorker(lang)
    throw e
  }
}

/** Read as it is and inverted (English), and as it is in Urdu: `all` = every
 *  set of lines (all are masked), `plain` = the English read (the AI's text hint). */
async function readBoth(img: Buffer, deadline: number): Promise<{ all: OcrLine[]; plain: OcrLine[] }> {
  const grey = await sharp(img).greyscale().png().toBuffer()
  const inverted = await sharp(img).greyscale().negate({ alpha: false }).png().toBuffer()
  // English (two reads, one worker) and Urdu (its own worker) side by side.
  const [eng, urdu] = await Promise.all([
    (async () => {
      const plain = await readLines(grey, 'eng', deadline)
      const inv = await readLines(inverted, 'eng', deadline)
      return { plain, inv }
    })(),
    readLines(grey, 'urd', deadline),
  ])
  // The Urdu model invents digits on English text, so only two kinds of its
  // lines are used: lines naming a contact word (رابطہ / نمبر / واٹس… — every
  // digit on them is masked), and digit words away from confident English words.
  const urduContact = urduContactLines(urdu)
  const urduDigits = urduDigitWords(urdu, [...eng.plain, ...eng.inv])
  return { all: [...eng.plain, ...eng.inv, ...urduContact, ...urduDigits], plain: eng.plain }
}

async function applyMask(img: Buffer, boxes: Box[], w: number, h: number): Promise<Buffer> {
  if (boxes.length === 0) return img
  return sharp(img)
    .composite([{ input: Buffer.from(maskSvg(boxes, w, h)), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

export type MaskFailKind = 'unsafe' | 'timeout' | 'type'
export type MaskedImage =
  | { ok: true; jpeg: Buffer; text: string; mobiles: string[]; masked: number }
  | { ok: false; kind: MaskFailKind; error: string; reason: string }

const fail = (kind: MaskFailKind, reason: string): MaskedImage => ({
  ok: false,
  kind,
  error: kind === 'timeout' ? IMAGE_TOO_SLOW : kind === 'type' ? IMAGE_WRONG_TYPE : IMAGE_UNSAFE,
  reason,
})

/** Steps 1–3: the image with every number blacked out, checked by a second read. */
export async function maskImage(input: Buffer, deadline: number = Date.now() + OCR_BUDGET_MS): Promise<MaskedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    meta = await sharp(input).metadata()
  } catch {
    return fail('type', 'not_an_image')
  }
  // HEIC / AVIF / GIF / TIFF / SVG are not read — the browser turns a phone
  // photo into a JPEG before upload, so this is only a photo it could not open.
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) return fail('type', `format_${meta.format ?? 'unknown'}`)
  try {
    // Upright, at most 2000 px wide/high; small screenshots are enlarged so OCR
    // can read their digits. Alpha flattened onto white.
    const base = sharp(input).rotate().flatten({ background: '#ffffff' })
    const m0 = await base.clone().metadata()
    // .rotate() turns EXIF orientations 5–8 sideways: width and height swap.
    const turned = (m0.orientation ?? 1) >= 5
    const width = (turned ? m0.height : m0.width) ?? 0
    const height = (turned ? m0.width : m0.height) ?? 0
    const longest = Math.max(width, height)
    if (!longest) return fail('type', 'no_size')
    const target = longest > 2000 ? 2000 : longest < 1200 ? 1200 : longest
    let img: Buffer = await base
      .resize({ width: width >= height ? target : undefined, height: height > width ? target : undefined })
      .png()
      .toBuffer()
    const meta2 = await sharp(img).metadata()
    const w = meta2.width ?? 0
    const h = meta2.height ?? 0

    const first = await readBoth(img, deadline)
    const plan = planMask(first.all, w, h)
    img = await applyMask(img, plan.boxes, w, h)
    let masked = plan.boxes.length

    // The after-check: read the masked image again, at most twice.
    let after = await readBoth(img, deadline)
    if (numberLeft(after.all)) {
      const again = planMask(after.all, w, h)
      img = await applyMask(img, again.boxes, w, h)
      masked += again.boxes.length
      for (const mob of again.mobiles) if (!plan.mobiles.includes(mob)) plan.mobiles.push(mob)
      after = await readBoth(img, deadline)
      if (numberLeft(after.all)) return fail('unsafe', 'number_still_readable')
    }

    // The OCR text of the masked image, redacted again — never sent if a number survives.
    const text = redactForAi(linesText(after.plain)).text
    if (hasNumberLeft(text)) return fail('unsafe', 'number_in_text')
    const jpeg = await sharp(img)
      .resize({ width: AI_IMAGE_MAX_PX, height: AI_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { ok: true, jpeg, text, mobiles: plan.mobiles, masked }
  } catch (e) {
    const reason = safeReason(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    console.warn(`[ai-image] masking failed: ${reason}`)
    return fail(e instanceof OcrTimeout ? 'timeout' : 'unsafe', e instanceof OcrTimeout ? reason : `ocr_error: ${reason}`)
  }
}

export const IMAGE_SYSTEM = [
  EXTRACT_SYSTEM,
  'The advert is an IMAGE (a poster or a screenshot). Black boxes hide phone numbers and emails — ignore them.',
  'A school or academy hiring a teacher ("We are hiring", "Teacher required") is a teacher job: pick the matching JOB TYPE (Primary / Middle School / High School / O Levels / A Levels Teacher, Visiting Teacher…), and put the school or academy name in "school".',
].join(' ')

/** `reason` is technical (no image or post content) — for the Owner's Audit log. */
export type ImageExtract = { ok: true; fill: AiFill; mobiles: string[] } | { ok: false; status: number; error: string; reason: string }

export type ImageDeps = {
  configured: () => boolean
  mask: (input: Buffer) => Promise<MaskedImage>
  lists: () => Promise<AiLists>
  complete: typeof completeWithImage
}
const REAL_DEPS: ImageDeps = { configured: isConfigured, mask: (b) => maskImage(b), lists: () => loadAiLists(), complete: completeWithImage }

const MASK_STATUS: Record<MaskFailKind, number> = { unsafe: 422, timeout: 504, type: 415 }

/** The whole "Read from image": mask, then the AI fills the form. The AI is
 *  called only with the MASKED image, and never when masking failed. (`deps`
 *  is for the tests — scripts/test-pr20.ts, scripts/test-pr21.ts.) */
export async function extractTuitionFromImage(input: Buffer, deps: ImageDeps = REAL_DEPS): Promise<ImageExtract> {
  if (!deps.configured()) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'ai_not_configured' }
  const masked = await deps.mask(input)
  if (!masked.ok) return { ok: false, status: MASK_STATUS[masked.kind], error: masked.error, reason: `mask_${masked.kind}: ${masked.reason}` }
  const lists = await deps.lists()
  if (lists.jobTitles.length === 0 || Object.keys(lists.tree).length === 0) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'lists_empty' }
  const prompt = extractPrompt(masked.text ? `(Text read from the image — may contain reading errors)\n${masked.text}` : '(Read the image.)', lists)
  if (hasNumberLeft(prompt.slice(prompt.indexOf('POST:')))) return { ok: false, status: 422, error: IMAGE_UNSAFE, reason: 'number_in_prompt' }
  const r = await deps.complete({
    system: IMAGE_SYSTEM,
    prompt,
    image: { mediaType: 'image/jpeg', base64: masked.jpeg.toString('base64') },
    maxTokens: 1200,
    timeoutMs: AI_IMAGE_TIMEOUT_MS,
  })
  if (!r.ok) {
    const kind = aiFailureKind(r.reason)
    const reason = `ai_${kind}: ${safeReason(r.reason)}`
    console.warn(`[ai-image] extract failed: ${reason}`)
    return { ok: false, status: kind === 'timeout' ? 504 : 503, error: aiFailureMessage(kind), reason }
  }
  const ai = parseAiJson(r.text)
  if (!ai) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'ai_unreadable_answer' }
  return { ok: true, fill: mapAiAnswer(ai, lists), mobiles: masked.mobiles }
}
