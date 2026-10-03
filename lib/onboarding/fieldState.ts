// lib/onboarding/fieldState.ts
//
// The ONE shared input colour-state rule (PR106-F §7), used by signup, the
// onboarding flow and settings forms so every field reads the same way:
//
//   empty  → soft neutral page ground (nothing typed yet)
//   valid  → light green fill + deep green border (filled and correct)
//   error  → light red fill + border (a REAL error only: wrong format, or a
//            required field left empty AFTER the member tried to continue)
//
// PURE (no React) so the state machine is unit-tested and shared. The colours
// are brand tokens only; every pair is in scripts/contrast-check.ts.

export type FieldState = 'empty' | 'valid' | 'error'

/**
 * Decide a field's colour state.
 * @param value   the current text
 * @param valid   whether the value is a valid/complete answer (default: non-empty)
 * @param showError  true once the member has tried to continue (so an empty or
 *                   wrong required field turns red); false shows no error yet
 */
export function fieldState(opts: { value: string; valid?: boolean; showError?: boolean }): FieldState {
  const filled = opts.value.trim().length > 0
  const valid = opts.valid ?? filled
  if (opts.showError && (!filled || !valid)) return 'error'
  if (filled && valid) return 'valid'
  return 'empty'
}

/** The Tailwind classes (background + border + text) for a field state. */
export function fieldStateClasses(state: FieldState): string {
  switch (state) {
    case 'valid':
      return 'bg-tm-tint-green border-tm-green-deep text-slate-700'
    case 'error':
      return 'bg-tm-tint-red border-tm-red text-slate-700'
    default:
      return 'bg-tm-bg border-gray-200 text-slate-700 focus:border-tm-navy'
  }
}
