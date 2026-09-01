// lib/cleanup.ts
//
// Finding accounts that are obviously not people, and deleting them.
//
// This is the one admin action with no undo, so the guards matter more than
// the detection. Nothing is ever deleted that:
//
//   * is a seed fixture (seed+…@tutormint.dev)
//   * is staff, or the owner
//   * has ANY data attached: a job, an application, a payment, a subscription,
//     a message, a report, a review or a demo
//
// The last one is the important one. "test.parent@tutormint.com" looks like
// junk and has twelve real jobs behind it — a name-based rule would have
// deleted a working account. So the data check is what decides, and the email
// heuristic only decides what to SHOW.
//
// A candidate is suspicious when its address cannot receive mail (no dot in
// the domain, "farooq@g") or is a near-miss of a common provider
// ("jameel@gmail.con"), or when it has sat unconfirmed for over a month.

import { createAdminClient } from '@/lib/supabase/admin'

export const PROTECTED_EMAIL_PREFIX = 'seed+'

const KNOWN_PROVIDERS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'proton.me',
]

/** Levenshtein distance, capped: only used to spot one- or two-key typos. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      last = tmp
    }
  }
  return prev[b.length]
}

export type EmailVerdict = { suspicious: boolean; reason: string | null }

export function judgeEmail(email: string | null | undefined): EmailVerdict {
  if (!email) return { suspicious: true, reason: 'No email address.' }

  const at = email.lastIndexOf('@')
  if (at < 1) return { suspicious: true, reason: 'Not an email address.' }

  const domain = email.slice(at + 1).toLowerCase()

  // "farooq@g", "aliasgharg@gagv" — a domain with no dot cannot resolve, so
  // nothing was ever delivered to it.
  if (!domain.includes('.')) {
    return { suspicious: true, reason: `"${domain}" is not a real domain — no mail can reach it.` }
  }

  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  if (tld.length < 2) return { suspicious: true, reason: 'Malformed domain.' }

  // "gmail.con", "gmial.com" — one keystroke from a provider we see daily.
  for (const known of KNOWN_PROVIDERS) {
    const d = distance(domain, known)
    if (d > 0 && d <= 2) {
      return { suspicious: true, reason: `"${domain}" looks like a typo of ${known}.` }
    }
  }

  return { suspicious: false, reason: null }
}

export type Candidate = {
  id: string
  email: string | null
  createdAt: string
  confirmed: boolean
  hasProfile: boolean
  role: string | null
  reason: string
}

/**
 * List accounts worth deleting. Read-only.
 *
 * Runs over auth.users rather than profiles because most junk here never got a
 * profile row at all — a signup that failed halfway leaves an auth user and
 * nothing else, and those are invisible to every other admin screen.
 */
export async function findJunkAccounts(): Promise<{ candidates: Candidate[]; scanned: number }> {
  const admin = createAdminClient()
  if (!admin) return { candidates: [], scanned: 0 }

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const users = list?.users ?? []

  const ids = users.map((u) => u.id)
  const chunk = <T,>(arr: T[], n: number) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

  // Every table that would make an account worth keeping. Anything with a row
  // in any of them is out, whatever its address looks like.
  const busy = new Set<string>()
  const collect = (rows: Record<string, unknown>[] | null, col: string) => {
    for (const r of rows ?? []) if (r[col]) busy.add(r[col] as string)
  }

  for (const group of chunk(ids, 200)) {
    const [jobs, apps, pays, subs, msgs, reports, reviews, demos, profiles] = await Promise.all([
      admin.from('jobs').select('parent_id').in('parent_id', group),
      admin.from('applications').select('tutor_id').in('tutor_id', group),
      admin.from('payments').select('user_id').in('user_id', group),
      admin.from('subscriptions').select('user_id').in('user_id', group),
      admin.from('messages').select('sender_id').in('sender_id', group),
      admin.from('reports').select('reporter_id').in('reporter_id', group),
      admin.from('reviews').select('parent_id').in('parent_id', group),
      admin.from('demo_requests').select('parent_id').in('parent_id', group),
      admin.from('profiles').select('id, role, admin_role').in('id', group),
    ])
    collect(jobs.data, 'parent_id')
    collect(apps.data, 'tutor_id')
    collect(pays.data, 'user_id')
    collect(subs.data, 'user_id')
    collect(msgs.data, 'sender_id')
    collect(reports.data, 'reporter_id')
    collect(reviews.data, 'parent_id')
    collect(demos.data, 'parent_id')

    for (const p of profiles.data ?? []) {
      // Staff are never candidates, however their address looks.
      if (p.role === 'admin' || p.admin_role) busy.add(p.id as string)
    }
  }

  const { data: allProfiles } = await admin.from('profiles').select('id, role')
  const profileById = new Map((allProfiles ?? []).map((p) => [p.id as string, p.role as string]))

  const thirtyDaysAgo = Date.now() - 30 * 86_400_000
  const candidates: Candidate[] = []

  for (const u of users) {
    const email = u.email ?? null

    if (email?.toLowerCase().startsWith(PROTECTED_EMAIL_PREFIX)) continue
    if (busy.has(u.id)) continue

    const verdict = judgeEmail(email)
    const confirmed = !!u.email_confirmed_at
    const stale = !confirmed && new Date(u.created_at).getTime() < thirtyDaysAgo

    if (!verdict.suspicious && !stale) continue

    candidates.push({
      id: u.id,
      email,
      createdAt: u.created_at,
      confirmed,
      hasProfile: profileById.has(u.id),
      role: profileById.get(u.id) ?? null,
      reason: verdict.reason ?? 'Unconfirmed for more than 30 days, with no activity.',
    })
  }

  candidates.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))
  return { candidates, scanned: users.length }
}
