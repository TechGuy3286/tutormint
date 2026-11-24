import 'server-only'

// lib/imageRead.ts — "Read from image" on staff Post a tuition (owner, 24 Nov
// 2026 — PR-20 Part C; made to work on Vercel in PR-21; PR-22 Part A: the AI
// reads the number printed on the image).
//
//   1. The image (the browser always sends a JPEG ≤ 2000 px; PNG / WebP also
//      read) is decoded IN MEMORY with sharp — turned upright, sized for
//      reading. It is never written to disk, storage or a log; a failure logs
//      its technical reason only.
//   2. Side by side:
//      - the AI reads the upright image (Owner decision, PR-22 option B: a
//        number printed on a PUBLIC poster or screenshot may be read by the
//        AI — never in pasted text, which stays strictly redacted) and fills
//        the same form as "Paste a post", plus `contactPhone`;
//      - plain OCR (tesseract.js — no AI) reads it too: in English as it is
//        and inverted (white text on a coloured poster), and in Urdu (Urdu
//        lines only where they name a contact word such as رابطہ, Urdu digits
//        only away from confident English words — imageMaskCore).
//   3. The two numbers are compared (lib/imageNumberCore): the same → used; a
//      disagreement → the AI's, "Check this number"; Urdu digits → always
//      "Check this number". An OCR failure or timeout never stops the fill.
//      The number field is always highlighted for staff, and the form's
//      contact checks run on it before Post is enabled.
//
// Time: the route may run 120 s. OCR has 45 s in all and no single OCR step
// may take over 30 s; a step that runs over (or an OCR worker that died) is
// dropped and restarted on the next request. The AI call has 35 s; it runs
// at the same time as OCR.

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
  stripNumbers,
  IMAGE_EXTRACT_SYSTEM,
  type AiFill,
  type AiLists,
} from '@/lib/aiTuitionExtractCore'
import { IMAGE_TOO_SLOW, IMAGE_UNSAFE, IMAGE_WRONG_TYPE, ocrMobiles, urduContactLines, urduDigitWords, type OcrLine } from '@/lib/imageMaskCore'
import { pickImageNumber, type ImageNumber, type OcrMobile } from '@/lib/imageNumberCore'

/** All OCR for one image (it runs beside the AI call). */
export const OCR_BUDGET_MS = 45_000
/** One OCR step (starting a worker, or one read). */
const OCR_STEP_MAX_MS = 30_000
/** The AI call (beside OCR) — well inside the route's 120 s. */
export const AI_IMAGE_TIMEOUT_MS = 35_000
/** The longest side of the image the AI gets (its own preferred size). */
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

export type ImageFailKind = 'timeout' | 'type' | 'unsafe'

/** The picture made ready: upright, sized for OCR (`img`, PNG) and for the AI (`jpeg`). */
export type PreparedImage =
  | { ok: true; img: Buffer; jpeg: Buffer }
  | { ok: false; kind: ImageFailKind; error: string; reason: string }

const fail = (kind: ImageFailKind, reason: string) => ({
  ok: false as const,
  kind,
  error: kind === 'timeout' ? IMAGE_TOO_SLOW : kind === 'type' ? IMAGE_WRONG_TYPE : IMAGE_UNSAFE,
  reason,
})

/** Step 1: decode in memory, turn upright, size it. Nothing is written anywhere. */
export async function prepareImage(input: Buffer): Promise<PreparedImage> {
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
    const img = await base
      .resize({ width: width >= height ? target : undefined, height: height > width ? target : undefined })
      .png()
      .toBuffer()
    const jpeg = await sharp(img)
      .resize({ width: AI_IMAGE_MAX_PX, height: AI_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { ok: true, img, jpeg }
  } catch (e) {
    return fail('type', `decode_error: ${safeReason(e instanceof Error ? `${e.name}: ${e.message}` : String(e))}`)
  }
}

export type OcrNumbers = { ok: true; mobiles: OcrMobile[] } | { ok: false; kind: ImageFailKind; reason: string }

/** Step 2: plain OCR (no AI) reads the mobiles printed on the image — the
 *  second reader the AI's number is compared against (lib/imageNumberCore). */
export async function ocrNumbers(img: Buffer, deadline: number = Date.now() + OCR_BUDGET_MS): Promise<OcrNumbers> {
  try {
    const read = await readBoth(img, deadline)
    return { ok: true, mobiles: ocrMobiles(read.all) }
  } catch (e) {
    const reason = safeReason(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    console.warn(`[ai-image] ocr failed: ${reason}`)
    return { ok: false, kind: e instanceof OcrTimeout ? 'timeout' : 'unsafe', reason }
  }
}

export const IMAGE_SYSTEM = [
  IMAGE_EXTRACT_SYSTEM,
  'The advert is an IMAGE (a public poster or a screenshot).',
  'A school or academy hiring a teacher ("We are hiring", "Teacher required") is a teacher job: pick the matching JOB TYPE (Primary / Middle School / High School / O Levels / A Levels Teacher, Visiting Teacher…), and put the school or academy name in "school".',
  'Also return contactPhone: the contact mobile number printed on the image (WhatsApp / call / contact), written as 03XXXXXXXXX in English digits, or null if there is none; and contactPhoneUrduDigits: true if that number is written in Urdu digits (۰۳۰۰…), else false.',
  'Never invent a number: if you cannot read every digit, use null. Never put a phone number in the description.',
].join(' ')

/** `reason` is technical (no image or post content) — for the Owner's Audit log. */
export type ImageExtract =
  | { ok: true; fill: AiFill; mobiles: string[]; number: ImageNumber }
  | { ok: false; status: number; error: string; reason: string }

export type ImageDeps = {
  configured: () => boolean
  prepare: (input: Buffer) => Promise<PreparedImage>
  ocr: (img: Buffer) => Promise<OcrNumbers>
  lists: () => Promise<AiLists>
  complete: typeof completeWithImage
}
const REAL_DEPS: ImageDeps = {
  configured: isConfigured,
  prepare: (b) => prepareImage(b),
  ocr: (b) => ocrNumbers(b),
  lists: () => loadAiLists(),
  complete: completeWithImage,
}

const PREPARE_STATUS: Record<ImageFailKind, number> = { unsafe: 422, timeout: 504, type: 415 }

/** The whole "Read from image" (PR-22): the AI reads the upright image (its
 *  printed number included) while OCR reads it too, side by side; the two
 *  numbers are compared (lib/imageNumberCore). An OCR failure never stops the
 *  fill — the AI's number is used alone. (`deps` is for the tests —
 *  scripts/test-pr22.ts, test-pr20, test-pr21.) */
export async function extractTuitionFromImage(input: Buffer, deps: ImageDeps = REAL_DEPS): Promise<ImageExtract> {
  if (!deps.configured()) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'ai_not_configured' }
  const prepared = await deps.prepare(input)
  if (!prepared.ok) return { ok: false, status: PREPARE_STATUS[prepared.kind], error: prepared.error, reason: `image_${prepared.kind}: ${prepared.reason}` }
  const lists = await deps.lists()
  if (lists.jobTitles.length === 0 || Object.keys(lists.tree).length === 0) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'lists_empty' }
  const prompt = extractPrompt('(Read the image.)', lists)
  const [ocr, r] = await Promise.all([
    deps.ocr(prepared.img).catch((): OcrNumbers => ({ ok: false, kind: 'unsafe', reason: 'ocr_threw' })),
    deps.complete({
      system: IMAGE_SYSTEM,
      prompt,
      image: { mediaType: 'image/jpeg', base64: prepared.jpeg.toString('base64') },
      maxTokens: 1200,
      timeoutMs: AI_IMAGE_TIMEOUT_MS,
    }),
  ])
  if (!r.ok) {
    const kind = aiFailureKind(r.reason)
    const reason = `ai_${kind}: ${safeReason(r.reason)}`
    console.warn(`[ai-image] extract failed: ${reason}`)
    return { ok: false, status: kind === 'timeout' ? 504 : 503, error: aiFailureMessage(kind), reason }
  }
  const ai = parseAiJson(r.text)
  if (!ai) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'ai_unreadable_answer' }
  const number = pickImageNumber(ocr.ok ? ocr.mobiles : null, ai.contactPhone, ai.contactPhoneUrduDigits)
  const fill = mapAiAnswer(ai, lists)
  // The description goes on the public tuition page: never a number in it.
  fill.description = stripNumbers(fill.description)
  return { ok: true, fill, mobiles: number.msisdn ? [number.msisdn] : [], number }
}
