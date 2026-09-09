// A reliable "the person interacted with something outside this element" trigger.
//
// WHY NOT onBlur / relatedTarget. Clicking a native <select> (or many other
// controls) does not reliably set `relatedTarget` across browsers, so a
// focus-based "did focus leave me" check never fires for a mouse user moving
// from one field to the next — which is exactly how a real person fills a form.
// A document-level pointerdown listener that asks "is the thing you pressed
// inside my root?" does fire, every time, for mouse, touch and pen.
//
// The document is INJECTED (not the global) so the decision — pointerdown, and a
// `contains` check — is unit-testable in node without a browser or jsdom.

/** The slice of Document this needs — injectable for tests. */
export type PointerDoc = {
  addEventListener(type: 'pointerdown', listener: (e: { target: unknown }) => void): void
  removeEventListener(type: 'pointerdown', listener: (e: { target: unknown }) => void): void
}

/** The slice of a root node this needs — anything with `contains`. */
export type ContainsRoot = { contains(node: unknown): boolean }

/**
 * Call `onOutside` whenever a pointerdown lands outside `getRoot()`. Returns an
 * unsubscribe function. A pointerdown inside the root (a subject checkbox, a
 * grid scrollbar, the Change button) is ignored, because `root.contains(target)`
 * is true.
 */
export function onOutsidePointerDown(
  doc: PointerDoc,
  getRoot: () => ContainsRoot | null,
  onOutside: () => void,
): () => void {
  const listener = (e: { target: unknown }) => {
    const root = getRoot()
    const target = e.target
    if (root && target != null && !root.contains(target)) onOutside()
  }
  doc.addEventListener('pointerdown', listener)
  return () => doc.removeEventListener('pointerdown', listener)
}
