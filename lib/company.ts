// lib/company.ts
//
// Who TutorMint legally is.
//
// The brand is written **TutorMint**, one word, everywhere a member looks. The
// two-word legal form appears ONLY inside the legal name "Tutor Mint (Private)
// Limited" and only in legal contexts: the footer copyright, Terms, Privacy,
// receipts, the payment merchant name, About. That distinction is a CLAUDE.md
// brand rule and it is the reason this file exists rather than a constant
// somewhere — one place decides which form a surface gets.
//
// EVERYTHING COMES FROM app_settings, with the placeholder as the fallback.
// Two of these facts do not exist yet: the SECP registration number (CUIN) and
// the NTN. They are seeded as the literal `{{COMPANY_REG_NO}}` and
// `{{COMPANY_NTN}}` (migration 38) so an admin can fill them in with no deploy,
// and so the page says plainly that we do not have them yet. A blank space
// would read as an oversight and "coming soon" would be a promise about a date
// nobody has set.
//
// `app_settings` is publicly readable by policy, which is what makes this safe
// to render on /terms and /about with the anon key.

import { createClient } from '@/lib/supabase/server'

export const REG_NO_PLACEHOLDER = '{{COMPANY_REG_NO}}'
export const NTN_PLACEHOLDER = '{{COMPANY_NTN}}'

export type Company = {
  /** "Tutor Mint (Private) Limited" — legal contexts only. */
  legalName: string
  /** "Tutor Mint (Pvt) Ltd" — the short legal form, for the footer line. */
  shortName: string
  /** "TutorMint" — the brand, one word, everywhere else. */
  brand: string
  address: string
  email: string
  /** SECP CUIN, or the placeholder while we do not have it. */
  regNo: string
  /** NTN, or the placeholder. */
  ntn: string
  /** True when the number is still a placeholder, so copy can say so. */
  regNoPending: boolean
  ntnPending: boolean
}

const DEFAULTS = {
  'company.legal_name': 'Tutor Mint (Private) Limited',
  'company.short_name': 'Tutor Mint (Pvt) Ltd',
  'company.address': '4th Floor, 37-M, Civic Center, Model Town, Lahore, Punjab, Pakistan',
  'company.email': 'support@tutormint.org',
  'company.reg_no': REG_NO_PLACEHOLDER,
  'company.ntn': NTN_PLACEHOLDER,
} as const

export async function getCompany(): Promise<Company> {
  let stored = new Map<string, string | null>()

  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', Object.keys(DEFAULTS))
    stored = new Map((data ?? []).map((r) => [r.key as string, (r.value as string) || null]))
  } catch {
    // A Terms page that cannot reach the database still has to render. These
    // are constants that happen to be editable, not per-request data.
  }

  const pick = (key: keyof typeof DEFAULTS) => (stored.get(key) || '').trim() || DEFAULTS[key]

  const regNo = pick('company.reg_no')
  const ntn = pick('company.ntn')

  return {
    legalName: pick('company.legal_name'),
    shortName: pick('company.short_name'),
    brand: 'TutorMint',
    address: pick('company.address'),
    email: pick('company.email'),
    regNo,
    ntn,
    regNoPending: regNo === REG_NO_PLACEHOLDER,
    ntnPending: ntn === NTN_PLACEHOLDER,
  }
}
