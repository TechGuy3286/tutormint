// lib/authMessages.ts
//
// Specific, plain, bilingual messages for the auth screens (PR75 §2). Client-safe
// (no server imports) so the forms and the routes read one source. A GoTrue error
// that is actionable (weak password, email already taken, rate limit, send
// failure) becomes an exact "here is what to fix" message; anything unexpected
// falls through to the generic message + reference code (PR72).

export type Bi = { en: string; ur: string }

// The banned-login message is owner-locked, verbatim (Sunday 6 Sep): a banned
// account is refused at login with this and no session is created. It lives here
// rather than inline in the route so scripts/test-auth-trust.ts can pin the
// exact wording without importing the route (which pulls in next/headers).
export const BANNED_LOGIN_MESSAGE =
  'Your account has been banned due to fraudulent activities. Please contact support.'

export const AUTH_MSG = {
  emailTaken: {
    en: 'This email already has an account. Sign in instead.',
    ur: 'اس ای میل کا پہلے سے اکاؤنٹ موجود ہے۔ اس کے بجائے سائن اِن کریں۔',
  },
  mobileTaken: {
    en: 'This mobile number already has an account. Sign in instead.',
    ur: 'اس موبائل نمبر کا پہلے سے اکاؤنٹ موجود ہے۔ اس کے بجائے سائن اِن کریں۔',
  },
  weakPassword: {
    en: 'Please choose a stronger password — at least 8 characters, and not a common or easily guessed one.',
    ur: 'براہ کرم مضبوط پاس ورڈ چنیں — کم از کم 8 حروف، اور کوئی عام یا آسانی سے اندازہ لگنے والا نہ ہو۔',
  },
  shortPassword: {
    en: 'Your password is too short. Use at least 8 characters.',
    ur: 'آپ کا پاس ورڈ بہت چھوٹا ہے۔ کم از کم 8 حروف استعمال کریں۔',
  },
  invalidEmail: {
    en: 'Enter a valid email address, like name@example.com.',
    ur: 'درست ای میل ایڈریس درج کریں، جیسے name@example.com۔',
  },
  invalidMobile: {
    en: 'Enter a Pakistani mobile number like 0300 1234567.',
    ur: 'پاکستانی موبائل نمبر درج کریں، جیسے 0300 1234567۔',
  },
  emailSendFailed: {
    en: "We couldn't send the confirmation email. Please try again in a minute, or sign up with your mobile number.",
    ur: 'ہم تصدیقی ای میل نہیں بھیج سکے۔ ایک منٹ بعد دوبارہ کوشش کریں، یا اپنے موبائل نمبر سے سائن اپ کریں۔',
  },
  tooMany: {
    en: 'Too many tries. Please wait a few minutes and try again.',
    ur: 'بہت زیادہ کوششیں۔ براہ کرم چند منٹ انتظار کر کے دوبارہ کوشش کریں۔',
  },
  invalidCredentials: {
    en: 'That email/mobile and password do not match. Check them and try again.',
    ur: 'ای میل/موبائل اور پاس ورڈ آپس میں نہیں ملتے۔ انہیں جانچ کر دوبارہ کوشش کریں۔',
  },
} as const

/** The minimum password length the forms hint and pre-check (Supabase enforces
 *  strength server-side; this is the obvious first thing to fix). */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Map a GoTrue / Supabase auth error message to one of the specific messages, or
 * null when it is not one we recognise (the caller then uses the generic + ref).
 * Matching is on substrings of the provider's own text, lower-cased.
 */
export function classifyAuthError(message: string | null | undefined): { key: keyof typeof AUTH_MSG; field?: 'password' | 'identifier'; signIn?: boolean } | null {
  const m = (message ?? '').toLowerCase()
  if (!m) return null
  if (m.includes('weak') || m.includes('pwned') || m.includes('easy to guess') || m.includes('compromised')) {
    return { key: 'weakPassword', field: 'password' }
  }
  if ((m.includes('password') && (m.includes('short') || m.includes('at least') || m.includes('length') || m.includes('6 char') || m.includes('8 char')))) {
    return { key: 'shortPassword', field: 'password' }
  }
  if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
    return { key: 'emailTaken', field: 'identifier', signIn: true }
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('rate_limit')) {
    return { key: 'tooMany' }
  }
  if (m.includes('send') && (m.includes('email') || m.includes('confirmation') || m.includes('mail'))) {
    return { key: 'emailSendFailed' }
  }
  if (m.includes('invalid') && m.includes('email')) {
    return { key: 'invalidEmail', field: 'identifier' }
  }
  return null
}
