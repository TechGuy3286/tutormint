// lib/formChecklist.ts
//
// The ONE self-explaining-form pattern (PR80). A form declares its required (and
// optional) parts as a list; the shared <FormChecklist> shows them up front as
// numbered items with a tick when done, the form disables its Save/Continue
// until every REQUIRED part is done (checklistReady), and <ChecklistStatus> under
// the button says exactly what is still missing — so a member never presses Save
// and meets a surprise error.
//
// PURE (no React) so the ready/missing logic is testable and shared. Each item's
// label is phrased as the ACTION the member takes ("Type your CNIC number",
// "Add a photo of the back") — it reads as a list item ("1. Type your CNIC
// number") AND, appended with "to continue", as the missing-line. Each item
// carries its Urdu, in the same style as the rest of the site.
//
// The client checks here MIRROR the server's existing validation — they do not
// replace it. Server validation stays exactly as it was.

export type ChecklistItem = {
  /** The action, English — e.g. "Type your CNIC number". */
  en: string
  /** The action, Urdu. */
  ur: string
  /** Whether this part is done. */
  done: boolean
  /** Optional parts never gate Save and are marked "(optional)". */
  optional?: boolean
}

/** Every REQUIRED part is done — the Save/Continue button may be enabled. */
export function checklistReady(items: ChecklistItem[]): boolean {
  return items.every((i) => i.optional || i.done)
}

/** The first incomplete REQUIRED part (drives the "what's missing" line), or null. */
export function firstMissing(items: ChecklistItem[]): ChecklistItem | null {
  return items.find((i) => !i.optional && !i.done) ?? null
}
