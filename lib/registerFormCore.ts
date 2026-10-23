// lib/registerFormCore.ts
//
// PURE rules for the /register "Create account" button (owner, 24 Oct 2026).
// The button stays a clear disabled grey until the form is ready, with one
// short line under it naming what is missing; when everything is filled in it
// turns brand red. Nothing else on the form changes.

export const PASSWORD_MIN = 8

export type RegisterFields = {
  role: string | null
  fullName: string
  identifier: string
  password: string
  acceptedTerms: boolean
}

export type Missing = 'role' | 'name' | 'identifier' | 'password' | 'terms'

const ADD_WORDS: Partial<Record<Missing, string>> = {
  name: 'your name',
  identifier: 'your mobile number or email',
  password: 'a password (8 or more characters)',
}

export function registerMissing(f: RegisterFields): Missing[] {
  const out: Missing[] = []
  if (f.role !== 'tutor' && f.role !== 'parent') out.push('role')
  if (!f.fullName.trim()) out.push('name')
  if (!f.identifier.trim()) out.push('identifier')
  if (f.password.length < PASSWORD_MIN) out.push('password')
  if (!f.acceptedTerms) out.push('terms')
  return out
}

export function registerReady(f: RegisterFields): boolean {
  return registerMissing(f).length === 0
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "Add your name and a password (8 or more characters) to continue", or null
 *  when the form is ready. Plain English. */
export function registerHint(f: RegisterFields): string | null {
  const missing = registerMissing(f)
  if (missing.length === 0) return null
  const parts: string[] = []
  if (missing.includes('role')) parts.push('choose Tutor or Parent')
  const adds = missing.map((m) => ADD_WORDS[m]).filter((w): w is string => !!w)
  if (adds.length) parts.push(`add ${list(adds)}`)
  if (missing.includes('terms')) parts.push('tick the Terms box')
  const sentence = `${list(parts)} to continue`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Ready: brand red. Not ready: a clear grey that does not look broken. */
export const BUTTON_READY = 'bg-tm-red text-white shadow-md hover:bg-tm-red-hover'
export const BUTTON_NOT_READY = 'cursor-not-allowed bg-gray-200 text-slate-700'
