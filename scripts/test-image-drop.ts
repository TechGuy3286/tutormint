/**
 * scripts/test-image-drop.ts — npm run test:imagedrop
 *
 * Drag-and-drop on staff Post a tuition's "Paste a post" card (25 Nov 2026).
 * The drop handler's rules (lib/imageDropCore) with fake DataTransfer objects,
 * plus source checks that a drop goes through the very same readImage() as
 * "Read from image". Reads nothing from production, writes nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DROP_FIRST_ONLY,
  DROP_NOT_IMAGE,
  DROP_OVERLAY,
  dragHasFiles,
  handleImageDrop,
  isDroppableImage,
  nextDragDepth,
  planDrop,
} from '../lib/imageDropCore'

const src = (p: string) => readFileSync(p, 'utf8')
type F = { type: string; name: string; size: number }
const file = (name: string, type: string): F => ({ name, type, size: 1000 })
const dt = (files: F[], types = files.length ? ['Files'] : ['text/plain']) => ({ types, files })

function run(d: ReturnType<typeof dt>) {
  const reads: { file: F; note: string | null }[] = []
  const errors: string[] = []
  const handled = handleImageDrop(d, { read: (f, n) => reads.push({ file: f, note: n }), showError: (m) => errors.push(m) })
  return { handled, reads, errors }
}

test('an image file calls the read-from-image handler', () => {
  for (const f of [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.JPEG', ''), file('d.webp', 'image/webp')]) {
    const r = run(dt([f]))
    assert.equal(r.handled, true)
    assert.deepEqual(r.reads, [{ file: f, note: null }], f.name)
    assert.deepEqual(r.errors, [])
  }
})

test('a non-image shows the friendly error and reads nothing', () => {
  for (const f of [file('poster.pdf', 'application/pdf'), file('notes.txt', 'text/plain'), file('x.gif', 'image/gif'), file('p.heic', 'image/heic')]) {
    const r = run(dt([f]))
    assert.equal(r.handled, true, 'taken, so the browser does not open the file')
    assert.deepEqual(r.reads, [], f.name)
    assert.deepEqual(r.errors, [DROP_NOT_IMAGE])
  }
  assert.ok(!/zod|error:/i.test(DROP_NOT_IMAGE), 'plain words')
})

test('multiple files: the first image is used with a small note', () => {
  const pdf = file('a.pdf', 'application/pdf')
  const one = file('one.png', 'image/png')
  const two = file('two.jpg', 'image/jpeg')
  const r = run(dt([pdf, one, two]))
  assert.deepEqual(r.reads, [{ file: one, note: DROP_FIRST_ONLY }])
  assert.deepEqual(r.errors, [])
  const r2 = run(dt([two, one]))
  assert.equal(r2.reads[0].file, two)
})

test('dragged text is left to the textarea', () => {
  const r = run(dt([]))
  assert.equal(r.handled, false)
  assert.deepEqual(r.reads, [])
  assert.deepEqual(r.errors, [])
  assert.equal(planDrop({ types: ['text/plain', 'text/html'], files: [] }).kind, 'text')
  assert.equal(dragHasFiles(['text/plain']), false)
  assert.equal(dragHasFiles(['Files']), true)
  assert.equal(dragHasFiles(null), false)
})

test('drag counter: children never flicker, drop and leave clear it', () => {
  let d = 0
  d = nextDragDepth(d, 'enter') // card
  d = nextDragDepth(d, 'enter') // textarea
  d = nextDragDepth(d, 'leave') // left the card's padding for the textarea
  assert.equal(d, 1, 'still highlighted')
  d = nextDragDepth(d, 'leave')
  assert.equal(d, 0)
  assert.equal(nextDragDepth(0, 'leave'), 0)
  assert.equal(nextDragDepth(5, 'drop'), 0)
  assert.equal(isDroppableImage(file('x.webp', '')), true)
})

test('the card uses the same pipeline as Read from image; nothing new is stored', () => {
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /handleImageDrop\(e\.dataTransfer, \{\s*read: \(file, extra\) => void readImage\(file, extra\)/)
  assert.match(box, /onDrop=\{onDrop\}/)
  assert.match(box, /aria-label=\{DROP_ZONE_LABEL\}/)
  assert.match(box, /border-dashed border-tm-navy bg-tm-tint-navy/)
  assert.match(box, /pointer-events-none/, 'the overlay never takes drag events (no flicker)')
  assert.match(box, /\{DROP_OVERLAY\}/)
  assert.equal(DROP_OVERLAY, 'Drop the screenshot or poster here')
  assert.match(box, /drag-and-drop/, 'helper copy mentions it')
  // Only one upload path: the existing route, and the size limit inside readImage.
  assert.equal(box.match(/fetch\('\/api\/admin\/jobs\/ai-extract-image'/g)?.length, 1)
  assert.match(box, /file\.size > IMAGE_PICK_MAX_BYTES/)
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(box), 'never kept in the browser either')
  // Button and Ctrl+V unchanged.
  assert.match(box, /onClick=\{\(\) => fileRef\.current\?\.click\(\)\}/)
  assert.match(box, /clipboardData/)
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(box), 'brand tokens only')
})
