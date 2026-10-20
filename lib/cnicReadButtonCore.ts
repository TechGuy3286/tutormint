// lib/cnicReadButtonCore.ts
//
// "Read number from photo" on the admin CNIC card (owner, 20 Oct 2026): the
// number is read from the CNIC FRONT, so with no front photo uploaded there is
// nothing to read — the button is disabled with a hint instead of a request
// that can only fail. PURE — unit-tested by scripts/test-header-timeline.ts.

export const CNIC_READ_NEEDS_FRONT = 'Upload the CNIC front first'

export function cnicReadButton(hasFrontPhoto: boolean, reading: boolean): { disabled: boolean; hint: string | null } {
  if (!hasFrontPhoto) return { disabled: true, hint: CNIC_READ_NEEDS_FRONT }
  return { disabled: reading, hint: null }
}
