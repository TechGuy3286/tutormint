// lib/peopleDirectoryCore.ts
//
// People — ONE member directory with three tabs, Tutors | Parents | Staff
// (owner, 21 Oct 2026). It replaced Verification → Tutors, Verification →
// Parents, Overview → Tutors and Documents to approve, which each counted a
// slightly different set of people (Verification → Parents listed 16 parents
// while the Overview said 10).
//
// THE ONE RULE for who counts (`excludedReason`), read by the People tabs, the
// Overview "New tutors" / "New parents" cards and the People sidebar badge, so
// every one of those numbers agrees:
//   • staff accounts (role 'admin') live on the Staff tab only;
//   • seed fixtures, the team account, test-named accounts (is_test_name) and
//     accounts marked as test accounts (hidden_from_public) are left out;
//   • a tutor or parent account that belongs to a member of staff — it was a
//     staff account once, or shares an email or mobile with one, or is linked
//     to one — is left out UNLESS it has real tutor or parent activity.
//     A staff member's own working tutor account is an ordinary tutor.
// "Show staff & test accounts" brings every left-out account back.
//
// PURE — no I/O; unit-tested by scripts/test-people-directory.ts.

export type PeopleTab = 'tutors' | 'parents' | 'staff'
export const PEOPLE_TABS: { key: PeopleTab; label: string }[] = [
  { key: 'tutors', label: 'Tutors' },
  { key: 'parents', label: 'Parents' },
  { key: 'staff', label: 'Staff' },
]

export function pickPeopleTab(v: string | null | undefined): PeopleTab {
  return v === 'parents' || v === 'staff' ? v : 'tutors'
}

// ---------------------------------------------------------------------------
// Who counts
// ---------------------------------------------------------------------------

export type ExcludeReason = 'staff' | 'seed' | 'team' | 'test' | 'merged'

export type PersonFacts = {
  role: string | null
  isSeed?: boolean | null
  isTeam?: boolean | null
  isTestName?: boolean | null
  /** profiles.hidden_from_public — the test-account flag (migration 126). */
  hidden?: boolean | null
  /** Was a staff account once, or shares an email / mobile with one, or is
   *  linked to one. */
  staffLinked?: boolean
  /** Real tutor or parent activity (see `hasActivity`). */
  activity?: boolean
  /** profiles.merged_into — "Merged into <name>" (owner, 26 Oct 2026). */
  mergedInto?: string | null
}

export function excludedReason(f: PersonFacts): ExcludeReason | null {
  if (f.role === 'admin') return 'staff'
  if (f.mergedInto) return 'merged'
  if (f.isSeed) return 'seed'
  if (f.isTeam) return 'team'
  if (f.isTestName || f.hidden) return 'test'
  if (f.staffLinked && !f.activity) return 'staff'
  return null
}

export const EXCLUDE_WORDS: Record<ExcludeReason, string> = {
  staff: 'Staff account',
  seed: 'Seed account',
  team: 'Team account',
  test: 'Test account',
  merged: 'Merged account',
}

/** Real activity. A tutor: paid the Verification Fee, finished onboarding or
 *  saved subjects. A parent: posted a tuition, paid for a plan, or sent their
 *  documents for review. */
export function hasActivity(
  role: string | null,
  f: { feePaid?: boolean; onboarded?: boolean; subjects?: number; tuitions?: number; paidPlan?: boolean; submitted?: boolean },
): boolean {
  if (role === 'tutor') return !!f.feePaid || !!f.onboarded || (f.subjects ?? 0) > 0
  if (role === 'parent' || role === 'academy') return (f.tuitions ?? 0) > 0 || !!f.paidPlan || !!f.submitted
  return false
}

export function isParentRole(role: string | null | undefined): boolean {
  return role === 'parent' || role === 'academy'
}

/** The ids of a staff member's own accounts, by email (any case) and by the
 *  last ten digits of a mobile. Never logged. */
export function staffLinkKeys(staff: { email?: string | null; phone?: string | null; whatsapp?: string | null }[]) {
  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const s of staff) {
    const e = (s.email ?? '').trim().toLowerCase()
    if (e) emails.add(e)
    for (const p of [s.phone, s.whatsapp]) {
      const d = last10(p)
      if (d) phones.add(d)
    }
  }
  return { emails, phones }
}

export function last10(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

// ---------------------------------------------------------------------------
// Tutors tab
// ---------------------------------------------------------------------------

export type PaidFilter = 'all' | 'paid' | 'unpaid'
/** Paid = the Verification Fee is paid by any method, an Owner-granted badge
 *  included (tutor_profiles.verified_fee_paid_at is set either way). */
export function paidTag(feePaidAt: string | null | undefined): 'paid' | 'unpaid' {
  return feePaidAt ? 'paid' : 'unpaid'
}

// ---------------------------------------------------------------------------
// Parents tab
// ---------------------------------------------------------------------------

export type ParentVerification = 'approved' | 'waiting' | 'rejected' | 'none'

/** One status per parent from the two review items (lib/parentDocsCore states):
 *  Approved when both are; Waiting when either waits; Rejected when either is
 *  rejected; otherwise Not submitted. */
export function parentVerification(cnic: string, address: string): ParentVerification {
  if (cnic === 'approved' && address === 'approved') return 'approved'
  if (cnic === 'pending' || address === 'pending') return 'waiting'
  if (cnic === 'rejected' || address === 'rejected') return 'rejected'
  return 'none'
}

export const PARENT_VERIFICATION_WORDS: Record<ParentVerification, string> = {
  approved: 'Approved',
  waiting: 'Waiting',
  rejected: 'Rejected',
  none: 'Not submitted',
}

/** The Parents tab's second chip row: Waiting for review, Verified, Not
 *  submitted — and Rejected, shown only when a parent is in it, so every parent
 *  is in exactly one chip. */
export const PARENT_CHIPS: { key: ParentVerification; label: string }[] = [
  { key: 'waiting', label: 'Waiting for review' },
  { key: 'approved', label: 'Verified' },
  { key: 'none', label: 'Not submitted' },
  { key: 'rejected', label: 'Rejected' },
]

export function postedTag(total: number): 'posted' | 'notposted' {
  return total > 0 ? 'posted' : 'notposted'
}

// ---------------------------------------------------------------------------
// Possible duplicates
// ---------------------------------------------------------------------------

export type DupPerson = {
  id: string
  name: string
  city: string | null
  /** Canonical mobile / WhatsApp numbers (any form; compared by last 10 digits). */
  phones: (string | null | undefined)[]
  /** 13 digits once normalised; never shown. */
  cnic: string | null | undefined
  /** The member's own second-role account — the same person by design. */
  linkedId?: string | null
}

export type DupReason = 'mobile' | 'cnic' | 'name'
export type DupLink = { id: string; name: string; reason: DupReason }

export const DUP_WORDS: Record<DupReason, string> = {
  mobile: 'same mobile',
  cnic: 'same CNIC',
  name: 'similar name, same city',
}

/** A name without case, spaces or punctuation: "Rab Nawaz" → "rabnawaz". */
export function compactName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Two names that read as the same person: equal once spaces and punctuation
 *  go ("Rabnawaz" / "Rab Nawaz"), or one letter apart when both are at least
 *  eight letters long. Short names are compared exactly, never fuzzily. */
export function similarNames(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = compactName(a)
  const y = compactName(b)
  if (x.length < 3 || y.length < 3) return false
  if (x === y) return true
  return x.length >= 8 && y.length >= 8 && levenshtein(x, y, 1) <= 1
}

const cityKey = (c: string | null | undefined) => (c ?? '').trim().toLowerCase()
const cnicKey = (c: string | null | undefined) => {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 13 ? d : null
}

/**
 * Members who look like the same person: the same mobile, the same CNIC, or a
 * very similar name in the same city. A member's own linked second-role
 * account is never tagged. Only tags — nothing is merged or changed.
 */
export function findPossibleDuplicates(people: DupPerson[]): Map<string, DupLink[]> {
  const out = new Map<string, DupLink[]>()
  const add = (a: DupPerson, b: DupPerson, reason: DupReason) => {
    if (a.id === b.id || a.linkedId === b.id || b.linkedId === a.id) return
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const list = out.get(x.id) ?? []
      if (!list.some((l) => l.id === y.id)) list.push({ id: y.id, name: y.name, reason })
      out.set(x.id, list)
    }
  }
  const byPhone = new Map<string, DupPerson[]>()
  const byCnic = new Map<string, DupPerson[]>()
  const byCity = new Map<string, DupPerson[]>()
  for (const p of people) {
    for (const ph of new Set(p.phones.map(last10).filter((x): x is string => !!x))) byPhone.set(ph, [...(byPhone.get(ph) ?? []), p])
    const c = cnicKey(p.cnic)
    if (c) byCnic.set(c, [...(byCnic.get(c) ?? []), p])
    const k = cityKey(p.city)
    if (k) byCity.set(k, [...(byCity.get(k) ?? []), p])
  }
  for (const group of byPhone.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'mobile')
  for (const group of byCnic.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'cnic')
  for (const group of byCity.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) if (similarNames(group[i].name, group[j].name)) add(group[i], group[j], 'name')
  return out
}

/** How many members carry a "Possible duplicate" tag. */
export function duplicateCount(tags: Map<string, DupLink[]>): number {
  let n = 0
  for (const v of tags.values()) if (v.length > 0) n++
  return n
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function peopleHref(tab: PeopleTab, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams()
  q.set('tab', tab)
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  return `/admin/users?${q}`
}

/** Old Verification → Tutors addresses (?filter=pending|all|suspended&q=). */
export function tutorsRedirect(sp: { filter?: string; q?: string }): string {
  return peopleHref('tutors', { docs: sp.filter === 'pending' ? 'waiting' : null, q: sp.q?.trim() || null })
}

/** Old Verification → Parents addresses (?filter=submitted|approved|all). */
export function parentsRedirect(sp: { filter?: string }): string {
  const f = sp.filter ?? 'submitted'
  return peopleHref('parents', { pv: f === 'submitted' ? 'waiting' : f === 'approved' ? 'approved' : f === 'rejected' ? 'rejected' : null })
}

/** The Overview lists that moved to People. */
export const OVERVIEW_KEY_PEOPLE: Record<string, string> = {
  tutors: peopleHref('tutors'),
  parents: peopleHref('parents'),
  'todo-docs': peopleHref('tutors', { docs: 'waiting' }),
}

/** /admin/overview/tutors?docs=…&q=… keeps its chip and search. */
export function overviewPeopleRedirect(key: string, sp: { docs?: string; q?: string }): string | null {
  const base = OVERVIEW_KEY_PEOPLE[key]
  if (!base) return null
  if (key !== 'tutors') return base
  return peopleHref('tutors', { docs: sp.docs && sp.docs !== 'all' ? sp.docs : null, q: sp.q?.trim() || null })
}

// ---------------------------------------------------------------------------
// The People sidebar badge
// ---------------------------------------------------------------------------

/** Documents waiting for the Owner: tutors in the Tutors tab's "Waiting"
 *  chip plus parents in the Parents tab's "Waiting for review" chip. */
export function waitingBadge(tutorDocKinds: (string | null | undefined)[], parentStates: ParentVerification[]): number {
  return tutorDocKinds.filter((k) => k === 'waiting').length + parentStates.filter((s) => s === 'waiting').length
}
