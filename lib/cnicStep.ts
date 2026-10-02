// The in-flow CNIC step's view decision, as a PURE function so it is unit-tested
// without the browser (PR106-A §8/§9).
//
//   approved  → the card is staff-approved AND the number + both photos are on
//               file: the step is LOCKED (read-only + "contact support").
//   submitted → sent for checking (or approved but missing a doc): "being checked".
//   capture   → still gathering the number/photos (prefilled when some exist).

export type CnicStepView = 'approved' | 'submitted' | 'capture'

export function cnicStepView(input: {
  state: 'none' | 'submitted' | 'approved' | 'rejected' | null | undefined
  hasNumber: boolean
  hasFront: boolean
  hasBack: boolean
}): CnicStepView {
  const hasDocs = input.hasNumber && input.hasFront && input.hasBack
  if (input.state === 'approved' && hasDocs) return 'approved'
  if (input.state === 'submitted' || input.state === 'approved') return 'submitted'
  return 'capture'
}
