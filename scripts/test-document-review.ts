/**
 * scripts/test-document-review.ts — npm run test:docreview
 * Document review (owner, 10 Oct 2026):
 *   - ONE shared admin viewer, rendered through a portal, with no layout loop
 *   - rotation is a display setting on the document row; the file is unchanged
 *   - the Partner (view-only) can neither rotate nor read
 *   - the CNIC reader's reply is validated (13 digits, "none", junk)
 *   - a read is a SUGGESTION: never saved as the confirmed number by itself
 *   - one read per uploaded image; only the CNIC front is sent; nothing logged
 *   - the duplicate warning is for staff only
 * The Claude API is mocked. Renders + source scans; no browser, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ViewerFrame } from '../components/admin/DocumentViewer'
import { CnicDuplicateWarning } from '../components/admin/AdminCnicNumberBox'
import { isRotation, normaliseRotation, rotateBy, swapsAspect } from '../lib/docRotation'
import {
  CNIC_READ_PROMPT,
  CNIC_READ_STALE_MS,
  CNIC_READ_SYSTEM,
  maskToLast4,
  parseCnicReading,
  pickCnicFront,
  readDecision,
  runCnicRead,
  type VisionReply,
} from '../lib/cnicReaderCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Source with comments removed, for "this code never does X" scans. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const noop = () => {}

const frame = (over: Partial<Parameters<typeof ViewerFrame>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ViewerFrame, {
      image: { src: '/api/documents/11111111-1111-1111-1111-111111111111/preview', alt: 'CNIC front', documentId: '11111111-1111-1111-1111-111111111111' },
      position: { at: 1, of: 4 },
      zoom: 1,
      pan: { x: 0, y: 0 },
      turns: 0,
      canRotate: true,
      saving: false,
      onZoom: noop,
      onPan: noop,
      onTurn: noop,
      onSave: noop,
      onStep: noop,
      onClose: noop,
      ...over,
    }),
  )

// ---------------------------------------------------------------- viewer ----

test('the viewer opens steady: a full-screen dialog sized from the viewport, with no layout loop', () => {
  const out = frame()
  assert.match(out, /role="dialog"/)
  assert.match(out, /aria-modal="true"/)
  assert.match(out, /class="fixed inset-0 /)
  assert.match(out, /aria-label="Close"/)
  // The picture is limited by the viewport, never by a measured box.
  assert.match(out, /container-type:size/)
  assert.match(out, /width:calc\(100cqw - 16px\);height:calc\(100cqh - 16px\)/)
  assert.doesNotMatch(out, /transition/)
  // The stage takes the pinch itself, so the page under it does not also move.
  assert.match(out, /touch-none/)

  const src = code('components/admin/DocumentViewer.tsx')
  // The root cause: it must be drawn in <body>, outside every (hover-transformed) card.
  assert.match(src, /createPortal\(/)
  assert.match(src, /document\.body,\s*\)/)
  for (const loop of ['ResizeObserver', 'getBoundingClientRect', 'onLoad', 'offsetWidth', 'offsetHeight', "addEventListener('resize'"]) {
    assert.ok(!src.includes(loop), `no ${loop}: nothing measures and re-renders`)
  }
  assert.doesNotMatch(src, /transition:/)
  // Closing is a click (a touchstart close let the follow-up click reopen the thumbnail).
  assert.doesNotMatch(src, /onTouchStart=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) onClose/)
  assert.match(src, /onClick=\{closeIfOutside\}/)
  assert.match(src, /e\.key === 'Escape'/)
  // The keyboard / scroll-lock effect depends on `open` alone.
  assert.match(src, /\}, \[open\]\)/)
})

test('a quarter turn swaps which side of the screen limits the picture, so it still fits', () => {
  const turned = frame({ turns: 90 })
  assert.match(turned, /width:calc\(100cqh - 16px\);height:calc\(100cqw - 16px\)/)
  assert.match(turned, /rotate\(90deg\)/)
  assert.match(frame({ turns: 180 }), /width:calc\(100cqw - 16px\)/)
})

test('one shared viewer for every admin document image; the old one is gone', () => {
  assert.ok(!existsSync('components/admin/Lightbox.tsx'))
  const users: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f)) {
        const s = read(p)
        assert.ok(!/admin\/Lightbox/.test(s), `${p} does not import the old viewer`)
        if (/from '@\/components\/admin\/DocumentViewer'/.test(s)) users.push(p.replace(/\\/g, '/'))
      }
    }
  }
  walk('components')
  walk('app')
  assert.deepEqual(users.sort(), [
    'app/admin/tutors/TutorModerationClient.tsx',
    'components/admin/DocumentThumb.tsx',
    'components/admin/ParentDocumentReview.tsx',
    'components/admin/TutorDocumentReview.tsx',
  ])
  // Every admin file that draws a stored document also opens it in the viewer.
  const drawers: string[] = []
  const scan = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) scan(p)
      else if (/\.tsx$/.test(f) && /<SecureDocumentPreview/.test(read(p))) drawers.push(p.replace(/\\/g, '/'))
    }
  }
  scan('app/admin')
  scan('components/admin')
  for (const p of drawers) assert.ok(users.includes(p), `${p} draws a document, so it uses the shared viewer`)
})

// -------------------------------------------------------------- rotation ----

test('rotation is 0 / 90 / 180 / 270 and nothing else', () => {
  assert.equal(normaliseRotation(450), 90)
  assert.equal(normaliseRotation(-90), 270)
  assert.equal(normaliseRotation('180'), 180)
  for (const junk of [45, 'abc', null, undefined, NaN, {}]) assert.equal(normaliseRotation(junk), 0)
  assert.equal(rotateBy(270, 90), 0)
  assert.equal(rotateBy(0, 270), 270) // "Rotate left"
  assert.equal(rotateBy(90, 90), 180)
  assert.ok(isRotation(270) && !isRotation(45) && !isRotation('90'))
  assert.ok(swapsAspect(90) && swapsAspect(270) && !swapsAspect(0) && !swapsAspect(180))
})

test('a rotation saves as a setting on the document row; the stored file is unchanged', () => {
  const save = code('lib/docRotationServer.ts')
  assert.doesNotMatch(save, /\.storage\b/, 'no storage call at all')
  assert.doesNotMatch(save, /sharp/)
  const updates = save.match(/\.update\(\{[^}]*\}\)/g) ?? []
  assert.deepEqual(updates, ['.update({ rotation })'], 'the only write is the rotation column')
  assert.match(save, /action: 'document\.rotate'/)
  assert.match(save, /oldRotation: previous, newRotation: rotation/)

  // The preview route turns the bytes on their way out and writes nothing.
  const preview = code('app/api/documents/[id]/preview/route.ts')
  assert.match(preview, /sharp\(Buffer\.from\(bytes\)\)\.rotate\(rotation\)/)
  assert.doesNotMatch(preview, /\.upload\(|\.update\(|\.remove\(|original_path/)

  const migration = read('supabase/migrations/160_document_rotation_cnic_read.sql')
  assert.match(migration, /rotation smallint not null default 0/)
  assert.match(migration, /check \(rotation in \(0, 90, 180, 270\)\)/)

  // Every screen shows the document through the one preview route, so the saved
  // rotation reaches the member's own screens as well.
  assert.match(read('components/SecureDocumentPreview.tsx'), /DOC_ROTATED_EVENT/)
  // Not behind the approved-document lock.
  assert.doesNotMatch(code('app/api/admin/documents/rotate/route.ts') + save, /decideUpload|docLock|loadLockFacts/)
})

// --------------------------------------------------------------- partner ----

test('the Partner (view-only) can neither rotate nor read', () => {
  for (const key of ['documentRotate', 'cnicRead'] as const) {
    assert.deepEqual([...SCREEN_ACCESS[key]].sort(), ['admin', 'operations'])
  }
  // Both are POST routes behind checkAdminRole, which refuses a Partner on any write.
  const rotate = code('app/api/admin/documents/rotate/route.ts')
  const readRoute = code('app/api/admin/documents/read-cnic/route.ts')
  assert.match(rotate, /export async function POST/)
  assert.match(rotate, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.documentRotate\)/)
  assert.match(readRoute, /export async function POST/)
  assert.match(readRoute, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.cnicRead\)/)
  assert.doesNotMatch(rotate + readRoute, /export async function GET/)
  const gate = code('lib/adminAuth.ts')
  assert.match(gate, /Partner accounts are view-only|PARTNER_VIEW_ONLY/)
  // And the UI does not offer either control.
  const noTools = frame({ canRotate: false })
  assert.doesNotMatch(noTools, /Rotate left|Rotate right|Save rotation/)
  assert.match(frame(), /Rotate left/)
  assert.match(frame(), /Rotate right/)
  assert.match(frame(), /Save rotation/)
  assert.match(code('components/admin/DocumentViewer.tsx'), /const canRotate = \(!!img\.documentId \|\| !!img\.profileId\) && !readOnly/)
  const box = code('components/admin/AdminCnicNumberBox.tsx')
  assert.match(box, /const mayWrite = canEdit && !readOnly/)
  assert.match(box, /\) : mayWrite \? \(/)
})

test('Save rotation is disabled until the picture has been turned', () => {
  assert.match(frame({ turns: 0 }), /<button type="button" disabled=""[^>]*>.*?Save rotation/)
  assert.doesNotMatch(frame({ turns: 90 }), /<button type="button" disabled=""[^>]*>.*?Save rotation/)
})

// ---------------------------------------------------------------- reader ----

test('the reader reply is validated: exactly 13 digits, "none", or not found', () => {
  assert.equal(parseCnicReading('35202-1234567-1'), '35202-1234567-1')
  assert.equal(parseCnicReading('3520212345671'), '35202-1234567-1')
  assert.equal(parseCnicReading('  35202 1234567 1\n'), '35202-1234567-1')
  for (const notFound of [
    'none',
    'None',
    '',
    null,
    undefined,
    '35202-1234567', // 12 digits
    '35202-1234567-12', // 14 digits
    'The number is 35202-1234567-1', // words around it
    '35202-1234567-1.', // trailing junk
    '35202-1234567-1 or 35202-1234567-7', // two numbers
    '35202-12345O7-1', // a letter for a digit
    '3520-21234567-1', // wrong grouping
    'I cannot read this card clearly.',
    '12345',
  ]) {
    assert.equal(parseCnicReading(notFound), null, `${JSON.stringify(notFound)} → not found`)
  }
  assert.equal(maskToLast4('35202-1234567-1'), 'XXXXX-XXXX567-1')
  assert.equal(maskToLast4('123'), null)
})

function mockRead(opts: {
  doc?: { cnic_read_status?: string | null; cnic_read_number?: string | null; cnic_read_at?: string | null }
  reply?: VisionReply
  claim?: boolean
  image?: boolean
}) {
  const calls = { vision: 0, claim: 0, release: 0, saved: [] as (string | null)[], sent: [] as unknown[] }
  const run = runCnicRead({
    doc: opts.doc ?? {},
    nowMs: Date.parse('2026-10-10T10:00:00Z'),
    claim: async () => {
      calls.claim++
      return opts.claim ?? true
    },
    release: async () => {
      calls.release++
    },
    loadImage: async () => (opts.image === false ? null : { mediaType: 'image/jpeg' as const, base64: 'AAAA' }),
    vision: async (image) => {
      calls.vision++
      calls.sent.push(image)
      return opts.reply ?? { ok: true, text: '35202-1234567-1' }
    },
    saveSuggestion: async (n) => {
      calls.saved.push(n)
    },
  })
  return { run, calls }
}

test('a clear read is cached on the document as a suggestion (mocked Claude API)', async () => {
  const { run, calls } = mockRead({})
  assert.deepEqual(await run, { status: 'found', number: '35202-1234567-1', cached: false })
  assert.equal(calls.vision, 1)
  assert.deepEqual(calls.saved, ['35202-1234567-1'])
  // Only the image is handed to the reader.
  assert.deepEqual(calls.sent, [{ mediaType: 'image/jpeg', base64: 'AAAA' }])
})

test('"none" and junk replies are cached as not found', async () => {
  for (const text of ['none', 'It looks like 35202-12345', 'Sorry, the image is blurred.']) {
    const { run, calls } = mockRead({ reply: { ok: true, text } })
    assert.deepEqual(await run, { status: 'none', cached: false })
    assert.deepEqual(calls.saved, [null])
  }
})

test('one read per uploaded image: a finished read never calls the API again', async () => {
  const found = mockRead({ doc: { cnic_read_status: 'found', cnic_read_number: '35202-1234567-1' } })
  assert.deepEqual(await found.run, { status: 'found', number: '35202-1234567-1', cached: true })
  const none = mockRead({ doc: { cnic_read_status: 'none' } })
  assert.deepEqual(await none.run, { status: 'none', cached: true })
  for (const c of [found.calls, none.calls]) {
    assert.equal(c.vision, 0)
    assert.equal(c.claim, 0)
    assert.deepEqual(c.saved, [])
  }
  // A read in flight is not started twice; a stale claim may be retried.
  const now = Date.parse('2026-10-10T10:00:00Z')
  const fresh = new Date(now - 10_000).toISOString()
  const stale = new Date(now - CNIC_READ_STALE_MS - 1000).toISOString()
  const flying = mockRead({ doc: { cnic_read_status: 'reading', cnic_read_at: fresh } })
  assert.deepEqual(await flying.run, { status: 'pending' })
  assert.equal(flying.calls.vision, 0)
  assert.deepEqual(readDecision({ cnic_read_status: 'reading', cnic_read_at: stale }, now), { kind: 'read' })
  const lost = mockRead({ claim: false })
  assert.deepEqual(await lost.run, { status: 'pending' })
  assert.equal(lost.calls.vision, 0)
})

test('a failed call caches nothing, so it can be tried again', async () => {
  const failed = mockRead({ reply: { ok: false, reason: 'timed out after 25000ms' } })
  assert.deepEqual(await failed.run, { status: 'unavailable' })
  assert.deepEqual(failed.calls.saved, [])
  assert.equal(failed.calls.release, 1)
  const noImage = mockRead({ image: false })
  assert.deepEqual(await noImage.run, { status: 'unavailable' })
  assert.equal(noImage.calls.vision, 0)
  assert.equal(noImage.calls.release, 1)
})

test('the CNIC front is the newest visible upload that is not the back', () => {
  const doc = (id: string, label: string | null, status: string, created_at: string, kind = 'cnic') => ({ id, kind, label, status, created_at })
  const docs = [
    doc('back', 'back', 'active', '2026-10-09'),
    doc('old-front', 'front', 'active', '2026-10-01'),
    doc('hidden-front', 'front', 'paused', '2026-10-09'),
    doc('new-front', 'front', 'review', '2026-10-08'),
    doc('selfie', null, 'active', '2026-10-09', 'selfie'),
  ]
  assert.equal(pickCnicFront(docs)?.id, 'new-front')
  assert.equal(pickCnicFront([docs[0], docs[4]]), null)
  assert.equal(pickCnicFront([doc('legacy', 'CNIC', 'active', '2026-09-01')])?.id, 'legacy')
})

test('privacy and cost: only the image is sent, nothing is logged, the button is rate-limited', () => {
  const reader = code('lib/cnicReader.ts')
  assert.match(reader, /completeWithImage\(\{ system: CNIC_READ_SYSTEM, prompt: CNIC_READ_PROMPT, image, maxTokens: 30, timeoutMs: 25_000 \}\)/)
  // The prompt is a fixed text: no name, id or number is put into it.
  assert.doesNotMatch(CNIC_READ_SYSTEM + CNIC_READ_PROMPT, /\$\{/)
  assert.match(CNIC_READ_PROMPT, /12345-1234567-1/)
  assert.match(CNIC_READ_PROMPT, /reply with exactly: none/)
  // Log lines carry the document id and the outcome word only.
  for (const line of reader.match(/console\.\w+\([^\n]*/g) ?? []) {
    assert.doesNotMatch(line, /number|base64|full_name|cnic_read_number/, `log line carries no number or image: ${line}`)
  }
  const vision = code('lib/ai/anthropic.ts')
  const fn = vision.slice(vision.indexOf('export async function completeWithImage'), vision.indexOf('export type ModelsResult'))
  assert.doesNotMatch(fn, /console\./, 'the vision call logs nothing')
  // The reader reads the ORIGINAL in memory and never writes storage.
  assert.doesNotMatch(reader, /\.upload\(|\.remove\(/)

  const route = code('app/api/admin/documents/read-cnic/route.ts')
  assert.match(route, /rateLimit\('cnic_read', gate\.actor\.id\)/)
  assert.match(code('lib/rateLimit.ts'), /cnic_read: \{ windowSeconds: 60, max: 10 \}/)
  // The backlog route returns the number masked, never whole.
  const internal = code('app/api/internal/suggest-cnic-numbers/route.ts')
  assert.match(internal, /cronAuthorised\(request\)/)
  assert.match(internal, /maskToLast4\(result\.number\)/)
  assert.doesNotMatch(internal, /number: result\.number/)
})

test('a suggestion is never saved as the confirmed number without a person pressing save', () => {
  // Nothing on the reader's path writes profiles at all.
  for (const p of [
    'lib/cnicReader.ts',
    'lib/cnicReaderCore.ts',
    'app/api/admin/documents/read-cnic/route.ts',
    'app/api/identity/cnic-suggestion/route.ts',
    'app/api/internal/suggest-cnic-numbers/route.ts',
    'lib/useCnicSuggestion.ts',
  ]) {
    const s = code(p)
    assert.doesNotMatch(s, /from\('profiles'\)\s*\.update|cnic_number:/, `${p} never writes the member's CNIC number`)
    assert.doesNotMatch(s, /save-number|set-cnic-number/, `${p} never calls a save path`)
  }
  // The reader's only writes are the cnic_read_* columns on the document.
  const reader = code('lib/cnicReader.ts')
  for (const u of reader.match(/\.update\(\{[^}]*\}\)/g) ?? []) assert.match(u, /cnic_read_/, u)
  // The upload route reads in the background and saves nothing from it.
  const upload = code('app/api/documents/upload/route.ts')
  assert.match(upload, /after\(async \(\) => \{\s*await readCnicFromDocument\(documentId\)\s*\}\)/)
  assert.match(upload, /kind === 'cnic' && label !== 'back'/)

  // Staff: the read fills the box; only Save posts the number.
  const box = code('components/admin/AdminCnicNumberBox.tsx')
  const readFn = box.slice(box.indexOf('const readFromPhoto'), box.indexOf('const save = async'))
  assert.doesNotMatch(readFn, /set-cnic-number|tutors\/edit/)
  assert.match(readFn, /setValue\(n\)/)
  assert.equal((box.match(/set-cnic-number/g) ?? []).length, 1)
  assert.match(box, /CNIC_SUGGESTED_STAFF/)
  assert.match(box, /CNIC_NOT_READ_STAFF/)

  // Member: the suggestion goes into the box state; save-number runs only from
  // the existing "save before upload" gate or the screen's own Next button.
  const capture = code('components/identity/CnicCapture.tsx')
  assert.match(capture, /setNumber\(formatCnic\(suggestion\)\)/)
  assert.match(capture, /CNIC_SUGGESTED_MEMBER_UR/)
  assert.equal((capture.match(/save-number/g) ?? []).length, 1)
  assert.doesNotMatch(code('lib/useCnicSuggestion.ts'), /method: 'POST'/)
})

test('the duplicate warning is shown to staff only', () => {
  const out = renderToStaticMarkup(createElement(CnicDuplicateWarning, { duplicate: { id: '22222222-2222-2222-2222-222222222222', name: 'Ali Raza' } }))
  assert.match(out, /This CNIC number is already on another account/)
  assert.match(out, /href="\/admin\/users\/22222222-2222-2222-2222-222222222222"/)
  assert.match(out, />Ali Raza</)
  assert.equal(renderToStaticMarkup(createElement(CnicDuplicateWarning, { duplicate: null })), '')
  // It comes only from the staff route, and it never blocks approval.
  assert.match(code('app/api/admin/documents/read-cnic/route.ts'), /cnicDuplicateFor/)
  for (const p of ['app/api/identity/cnic-suggestion/route.ts', 'lib/useCnicSuggestion.ts', 'components/identity/CnicCapture.tsx']) {
    assert.doesNotMatch(code(p), /duplicate|cnicDuplicateFor|full_name/i, `${p} tells a member nothing about another account`)
  }
  assert.doesNotMatch(code('app/api/admin/tutors/document-review/route.ts'), /cnicDuplicateFor/)
})
