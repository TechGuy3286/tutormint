import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { isSyntheticEmail } from '@/lib/phone'

// Abandoned signups — accounts that started but never crossed the line.
//
// Two stages a signup gets stuck at, each with a different next step:
//   'email_unconfirmed'  — signed up with an EMAIL, never clicked the link
//                          (auth.users.email_confirmed_at is null).
//   'profile_unfinished' — verified, but profile_completion never reached 100.
//
// The 'mobile_unverified' stage is GONE (owner, 11 Sep 2026). A mobile signup no
// longer creates an account until the code verifies — the draft lives in
// pending_signups and is discarded if it never verifies — so there is no
// unverified-mobile account row left to nudge, and a category that is always
// empty is worse than none.
//
// email_confirmed_at is not a profiles column — it lives on auth.users and is
// readable only through the Auth admin API (same as lib/adminOrphans). So this
// enumerates auth users once and joins the profiles rows to classify.
//
// The CHANNEL is the one the member gave: a (verified) mobile signup is reached
// on WhatsApp, an email signup by email. Never the other way round — a synthetic
// <msisdn>@users.tutormint.org address accepts no mail, and an email-only member
// has no mobile to WhatsApp.

export type SignupStage = 'email_unconfirmed' | 'profile_unfinished'
export type OutreachChannel = 'email' | 'whatsapp'

export type AbandonedSignup = {
  userId: string
  stage: SignupStage
  role: string | null
  channel: OutreachChannel
  /** For display: the real email (email channel) or a masked mobile (whatsapp). */
  contact: string
  fullName: string | null
  completion: number
  createdAt: string
  /** The seeded template key that fits this stage. */
  templateKey: string
}

const STAGE_TEMPLATE: Record<SignupStage, string> = {
  email_unconfirmed: 'signup_email_unconfirmed',
  profile_unfinished: 'signup_profile_unfinished',
}

function maskMobile(msisdn: string): string {
  const d = msisdn.replace(/\D/g, '')
  if (d.length <= 5) return '***'
  return `${d.slice(0, 2)}${'*'.repeat(d.length - 5)}${d.slice(-3)}`
}

/** A fixture we must never send outreach to. */
function isSeed(email: string | null): boolean {
  const e = (email ?? '').toLowerCase()
  return e.startsWith('seed+') || e.endsWith('@tutormint.dev')
}

type ProfileRow = {
  id: string
  role: string | null
  full_name: string | null
  email: string | null
  phone_number: string | null
  whatsapp: string | null
  phone_gate_required: boolean | null
  phone_verified_at: string | null
  profile_completion: number | null
  is_banned: boolean | null
  is_suspended: boolean | null
  is_team_account: boolean | null
}

export async function loadAbandonedSignups(): Promise<{ rows: AbandonedSignup[]; ok: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], ok: false }

  // Every profile, keyed by id — small on this platform. Paged so a cap cannot
  // silently drop rows.
  const profiles = new Map<string, ProfileRow>()
  {
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin
        .from('profiles')
        .select(
          'id, role, full_name, email, phone_number, whatsapp, phone_gate_required, phone_verified_at, profile_completion, is_banned, is_suspended, is_team_account',
        )
        .range(from, from + pageSize - 1)
      if (error) return { rows: [], ok: false }
      for (const p of (data ?? []) as ProfileRow[]) profiles.set(p.id, p)
      if (!data || data.length < pageSize) break
    }
  }

  // Auth users for email_confirmed_at + created_at, paginated (perPage is the
  // Supabase max). created_at is the signup date the view shows.
  const rows: AbandonedSignup[] = []
  const perPage = 200
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return { rows, ok: false }
    const users = data?.users ?? []
    for (const u of users) {
      const p = profiles.get(u.id)
      if (!p) continue // a true orphan — that is /admin/orphans, not this screen
      // Never surface fixtures, banned/suspended accounts, or the team account.
      if (isSeed(p.email) || p.is_banned || p.is_suspended || p.is_team_account) continue

      const emailConfirmed = !!u.email_confirmed_at
      const synthetic = isSyntheticEmail(p.email ?? '')
      const mobileSignup = !!p.phone_gate_required || synthetic
      const completion = p.profile_completion ?? 0
      const createdAt = u.created_at ?? ''

      let stage: SignupStage | null = null
      if (!mobileSignup && !emailConfirmed) {
        stage = 'email_unconfirmed'
      } else if ((p.phone_verified_at || emailConfirmed) && completion < 100) {
        stage = 'profile_unfinished'
      }
      // A legacy unverified-mobile account (mobileSignup && !phone_verified_at)
      // now falls through to null — no such account is created any more, and the
      // stale legacy ones are not surfaced (owner, 11 Sep 2026).
      if (!stage) continue // fully onboarded, or nothing to nudge

      // Channel is the one they gave. Refuse a row we could not actually reach:
      // a mobile signup with no number on file, or an email stage on a synthetic
      // address, is not messageable and is skipped rather than shown as a dead
      // button.
      const channel: OutreachChannel = mobileSignup ? 'whatsapp' : 'email'
      let contact: string
      if (channel === 'whatsapp') {
        const msisdn = (p.whatsapp || p.phone_number || '').replace(/\D/g, '')
        if (!msisdn) continue
        contact = maskMobile(msisdn)
      } else {
        if (!p.email || synthetic) continue
        contact = p.email
      }

      rows.push({
        userId: u.id,
        stage,
        role: p.role,
        channel,
        contact,
        fullName: p.full_name,
        completion,
        createdAt,
        templateKey: STAGE_TEMPLATE[stage],
      })
    }
    if (users.length < perPage) break
  }

  // Newest first — a fresh abandonment is the one most worth catching.
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return { rows, ok: true }
}

export const STAGE_LABEL: Record<SignupStage, string> = {
  email_unconfirmed: 'Email not confirmed',
  profile_unfinished: 'Profile unfinished',
}
