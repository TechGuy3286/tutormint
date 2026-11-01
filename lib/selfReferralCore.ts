// lib/selfReferralCore.ts
//
// PURE. No self-referral credit (owner, 2 Nov 2026, Part H). A staff member
// never gets sign-up or paid credit for an account that matches THEM:
//   - the same phone (mobile, WhatsApp or second number — last 10 digits), or
//   - the same CNIC (13 digits), or
//   - the same normalised name TOGETHER WITH the same device or IP at sign-up.
// Such a sign-up is credited to Admin instead, with the reason logged.
//
// "Same normalised name": letters only, lower case, honorifics dropped
// (Muhammad, Syed …), and every word of the shorter name found in the longer
// one — so "Khizra" matches "Khizra Danish". A name on its own never matches;
// it needs the device or IP as well. Device and IP are compared as hashes only.

export type SelfReferralPerson = {
  name: string | null
  phones: (string | null | undefined)[]
  cnic: string | null
  /** Hashes of the browser ids seen for this person. */
  devices: string[]
  /** Hashes of the IP addresses seen for this person. */
  ips: string[]
}

export type SelfReferralReason = 'same_phone' | 'same_cnic' | 'same_name_device' | 'same_name_ip'

const HONORIFICS = new Set(['muhammad', 'mohammad', 'muhammed', 'mohammed', 'm', 'syed', 'sayed', 'syeda', 'hafiz', 'hafiza', 'miss', 'mrs', 'mr', 'ms', 'dr', 'sir', 'madam'])

export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
}

/** Every word of the shorter name is in the longer one, and at least one of
 *  them has 3+ letters. */
export function sameNormalisedName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameTokens(a)
  const y = nameTokens(b)
  if (!x.length || !y.length) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const set = new Set(long)
  return short.every((t) => set.has(t)) && short.some((t) => t.length >= 3)
}

const phoneKey = (p: string | null | undefined): string | null => {
  const d = (p ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}
const cnicKey = (c: string | null | undefined): string | null => {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 13 ? d : null
}

export function selfReferralMatch(
  member: SelfReferralPerson,
  staff: SelfReferralPerson,
  opts: { nameAlone?: boolean } = {},
): { match: boolean; reasons: SelfReferralReason[] } {
  const reasons: SelfReferralReason[] = []
  const staffPhones = new Set(staff.phones.map(phoneKey).filter((x): x is string => !!x))
  if (member.phones.map(phoneKey).some((p) => p && staffPhones.has(p))) reasons.push('same_phone')
  const mc = cnicKey(member.cnic)
  if (mc && mc === cnicKey(staff.cnic)) reasons.push('same_cnic')
  if (sameNormalisedName(member.name, staff.name)) {
    if (opts.nameAlone) reasons.push('same_name_device')
    else {
      const sd = new Set(staff.devices)
      const si = new Set(staff.ips)
      if (member.devices.some((d) => sd.has(d))) reasons.push('same_name_device')
      if (member.ips.some((i) => si.has(i))) reasons.push('same_name_ip')
    }
  }
  return { match: reasons.length > 0, reasons }
}

/** The log line for a refused credit. */
export const SELF_REFERRAL_REFUSAL = 'self_referral'
