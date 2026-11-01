// PURE. What /api/viewer/tuition answers (push 3, owner 1 Nov 2026): the
// signed-in visitor's side of ONE cached tuition page.

import type { ApplyBlock } from '@/lib/applyBlock'

export type RevealedContact = {
  phone: string | null
  whatsapp: string | null
  email: string | null
  textPhones?: string[]
  textEmails?: string[]
}

export type TuitionViewer =
  | { signedIn: false }
  | {
      signedIn: true
      isTutor: boolean
      isAdmin: boolean
      isPoster: boolean
      applied: boolean
      tutorGender: string | null
      applyBlock: ApplyBlock | null
      feeReceiptPending: boolean
      /** The full contact when this tutor already has access (no spend). */
      revealedContact: RevealedContact | null
      /** "pauses in N days" for the poster or an admin on an open tuition. */
      pauseLabel: string | null
    }

/** Apply shows for a guest and a tutor on an open tuition, never for anyone else
 *  (the rule the page applied on the server before push 3). */
export function showApplyForViewer(v: TuitionViewer | null, isOpen: boolean): boolean {
  if (!isOpen) return false
  return !v || !v.signedIn || v.isTutor
}
