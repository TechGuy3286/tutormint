// Drag-and-drop on staff Post a tuition's "Paste a post" card (owner, 25 Nov
// 2026). A dropped picture goes through exactly the same readImage() as the
// "Read from image" button (components/forms/PastePostBox.tsx) — the same
// shrink, the same /api/admin/jobs/ai-extract-image route, the same number
// handling; it is never stored. Dragged TEXT is left to the textarea.
// Pure rules only, so scripts/test-image-drop.ts can run them without a browser.

/** Drop accepts PNG, JPG/JPEG and WebP only (the button also tries phone HEIC). */
export const DROP_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
const DROP_EXT_RE = /\.(png|jpe?g|webp)$/i

export const DROP_OVERLAY = 'Drop the screenshot or poster here'
export const DROP_ZONE_LABEL = 'Paste a post — or drop a screenshot or poster here'
export const DROP_NOT_IMAGE = "That file isn't a picture. Drop a screenshot or poster (PNG, JPG or WebP)."
export const DROP_FIRST_ONLY = 'More than one file was dropped — the first picture was used.'

export type DropFile = { type: string; name: string }
export type DropData<F extends DropFile> = { types: ArrayLike<string>; files: ArrayLike<F> }

/** Is a FILE being dragged (not text)? Only then does the card light up. */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false
  return Array.from(types).includes('Files')
}

export function isDroppableImage(f: DropFile): boolean {
  if (f.type) return (DROP_TYPES as readonly string[]).includes(f.type.toLowerCase())
  return DROP_EXT_RE.test(f.name) // some OSes give no type for a dragged file
}

export type DropPlan<F> = { kind: 'text' } | { kind: 'error'; error: string } | { kind: 'read'; file: F; note: string | null }

/** What a drop does: text → the textarea's own behaviour; files → the first
 *  picture is read (a note when more than one file came), none → the error. */
export function planDrop<F extends DropFile>(dt: DropData<F>): DropPlan<F> {
  const files = Array.from(dt.files ?? [])
  if (files.length === 0 || !dragHasFiles(dt.types)) return { kind: 'text' }
  const first = files.find(isDroppableImage)
  if (!first) return { kind: 'error', error: DROP_NOT_IMAGE }
  return { kind: 'read', file: first, note: files.length > 1 ? DROP_FIRST_ONLY : null }
}

/** The drop handler. Returns true when it took the drop (the caller then calls
 *  preventDefault); false leaves a text drop to the textarea. */
export function handleImageDrop<F extends DropFile>(
  dt: DropData<F>,
  deps: { read: (file: F, note: string | null) => void; showError: (msg: string) => void },
): boolean {
  const plan = planDrop(dt)
  if (plan.kind === 'text') return false
  if (plan.kind === 'error') deps.showError(plan.error)
  else deps.read(plan.file, plan.note)
  return true
}

/** Drag counter: enter/leave fire for every child, so the highlight is on
 *  while the count is above 0 and never flickers between children. */
export function nextDragDepth(depth: number, ev: 'enter' | 'leave' | 'drop'): number {
  if (ev === 'drop') return 0
  return ev === 'enter' ? depth + 1 : Math.max(0, depth - 1)
}
