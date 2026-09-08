// lib/ensureProfile.ts
//
// The ONE authoritative profile upsert, used by every path that creates an
// auth user: /api/auth/register, lib/staff.ts (invites) and lib/import.ts
// (bulk import).
//
// WHY IT EXISTS (root cause, 9 Sep). The `on_auth_user_created` trigger on
// auth.users — which wrote the profiles row from signup metadata — was silently
// dropped by the 5 Sep region migration (a public-schema dump does not carry an
// auth-schema trigger). Every path that created an auth user then relied on a
// row the trigger was no longer making: register wrote nothing, and staff/import
// did a `.update().eq(id)` that hit ZERO rows and failed silently — undetected
// from 5 Sep. Migration 59 restored the trigger, but belt-and-braces is the
// rule: this upsert CREATES the row whether or not the trigger fired, because it
// supplies every NOT-NULL-without-default column on `profiles` (id, full_name,
// email, phone_number). If the trigger is present it runs first (metadata → the
// same row) and this is a harmless idempotent update; if it is ever lost again,
// this still creates the row.
//
// It mirrors what migration 14's handle_new_user() does: the profiles row (with
// the account_type mirror), plus a minimal tutor_profiles row for a tutor.
// Callers with a richer tutor_profiles of their own (the bulk import) pass
// skipTutorProfile and write it themselves.

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type EnsureProfileOpts = {
  userId: string
  role: 'tutor' | 'parent' | 'admin'
  fullName: string
  email: string
  /** Defaults to '' — the column is NOT NULL and mobile is verified later. */
  phoneNumber?: string
  /** Mobile-first signups only: hold the account on /verify-phone. */
  phoneGateRequired?: boolean
  /** First-touch attribution, written once at signup. */
  utm?: Record<string, unknown>
  /** Extra profile columns for staff/import: admin_role, whatsapp, city,
   *  must_change_password. Spread last so a caller can override. */
  extra?: Record<string, unknown>
  /** The bulk import writes its own richer tutor_profiles; skip the minimal one. */
  skipTutorProfile?: boolean
}

export async function ensureProfile(
  admin: Admin,
  opts: EnsureProfileOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: pErr } = await admin.from('profiles').upsert(
    {
      id: opts.userId,
      role: opts.role,
      account_type: opts.role === 'parent' ? 'parent' : null,
      full_name: opts.fullName,
      email: opts.email,
      phone_number: opts.phoneNumber ?? '',
      ...(opts.phoneGateRequired ? { phone_gate_required: true } : {}),
      ...(opts.utm ?? {}),
      ...(opts.extra ?? {}),
    },
    { onConflict: 'id' },
  )
  if (pErr) return { ok: false, error: pErr.message }

  if (opts.role === 'tutor' && !opts.skipTutorProfile) {
    const { error: tErr } = await admin.from('tutor_profiles').upsert(
      { id: opts.userId, full_name: opts.fullName, email: opts.email, verification_status: 'pending' },
      { onConflict: 'id' },
    )
    if (tErr) return { ok: false, error: tErr.message }
  }
  return { ok: true }
}
