// npm run test:outsidepointer
//
// Verifies the subjects-grid collapse TRIGGER — the thing that was broken. The
// last attempt used onBlur/relatedTarget, which does not fire when a mouse user
// clicks a native <select>, so the grid never collapsed. This asserts the new
// trigger's actual mechanism: a DOCUMENT pointerdown listener, and a
// root.contains(target) inside/outside decision.
//
// It cannot prove a real browser dispatches pointerdown when you click the city
// field — that is a browser guarantee, and this environment has no browser or
// jsdom. What it CAN prove, and does, is that our code listens on 'pointerdown'
// (not focus/blur) and collapses only on an outside target. The document is
// injected for exactly this reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { onOutsidePointerDown, type PointerDoc } from '../lib/outsidePointer'

/** A fake document that captures the one pointerdown listener and lets a test
 *  fire it, plus records which event types were subscribed. */
function fakeDoc() {
  const types: string[] = []
  let listener: ((e: { target: unknown }) => void) | null = null
  const doc: PointerDoc = {
    addEventListener: (type, l) => {
      types.push(type)
      listener = l
    },
    removeEventListener: (type, l) => {
      if (listener === l) listener = null
    },
  }
  return {
    doc,
    types,
    attached: () => listener !== null,
    fire: (target: unknown) => listener?.({ target }),
  }
}

// A root whose "inside" nodes are a known set; everything else is outside.
const rootWith = (inside: unknown[]): { contains(n: unknown): boolean } => ({
  contains: (n) => inside.includes(n),
})

test('it listens on pointerdown, never on focus/blur', () => {
  const f = fakeDoc()
  onOutsidePointerDown(f.doc, () => rootWith([]), () => {})
  assert.deepEqual(f.types, ['pointerdown'])
})

test('a pointerdown OUTSIDE the root collapses (the city field)', () => {
  const f = fakeDoc()
  const city = { id: 'city' }
  let collapsed = 0
  onOutsidePointerDown(f.doc, () => rootWith([{ id: 'checkbox' }]), () => {
    collapsed++
  })
  f.fire(city) // not in the root's inside set
  assert.equal(collapsed, 1)
})

test('a pointerdown INSIDE the root does nothing (selecting a subject)', () => {
  const f = fakeDoc()
  const checkbox = { id: 'checkbox' }
  let collapsed = 0
  onOutsidePointerDown(f.doc, () => rootWith([checkbox]), () => {
    collapsed++
  })
  f.fire(checkbox) // the subject checkbox is inside the selector
  assert.equal(collapsed, 0)
})

test('a null target (nothing pressed) does nothing', () => {
  const f = fakeDoc()
  let collapsed = 0
  onOutsidePointerDown(f.doc, () => rootWith([]), () => {
    collapsed++
  })
  f.fire(null)
  assert.equal(collapsed, 0)
})

test('a missing root does nothing (never collapse when we cannot tell)', () => {
  const f = fakeDoc()
  let collapsed = 0
  onOutsidePointerDown(f.doc, () => null, () => {
    collapsed++
  })
  f.fire({ id: 'anything' })
  assert.equal(collapsed, 0)
})

test('the unsubscribe removes the listener', () => {
  const f = fakeDoc()
  const off = onOutsidePointerDown(f.doc, () => rootWith([]), () => {})
  assert.equal(f.attached(), true)
  off()
  assert.equal(f.attached(), false)
})
