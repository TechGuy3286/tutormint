/**
 * scripts/reset-seed-cast.ts
 *
 *   npx tsx scripts/reset-seed-cast.ts          # report the drift, write nothing
 *   npx tsx scripts/reset-seed-cast.ts --apply  # put each account back
 *
 * Puts every named seed account (scripts/seedCast.ts) back to its intended
 * plan, status, verification and completion, so the cast matches its own names.
 * Idempotent: a second run reports no changes.
 *
 * What it touches, per member:
 *   - subscriptions: cancels every active/paused row, then inserts ONE active
 *     row of the intended plan (30 days out) when the member should have a plan.
 *   - tutor_profiles.verification_status and profiles.is_suspended for tutors.
 *   - profiles.cnic_verified_at / address_verified_at for parents (the free
 *     verified tier is CNIC + address approved with no subscription).
 *   - profiles.profile_completion when the cast pins it.
 *
 * It never deletes an account and never touches an account not named in the
 * cast (the admin staff and the incomplete/other fixtures are left alone).
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SEED_CAST, expectedIdentity, type CastMember } from './seedCast'
import { guardWrites, die } from './target'

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch {
    /* optional */
  }
  return env
}

const THIRTY_DAYS = 30 * 86_400_000

async function main() {
  const env = loadEnv()
  const apply = process.argv.includes('--apply')

  await guardWrites({
    scriptName: 'reset-seed-cast -- restore the named seed accounts to intent',
    env,
    action: apply
      ? 'Resets each named seed account to its intended plan, status and verification.'
      : 'Dry run only: reports the drift, writes nothing.',
    dryRun: !apply,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const changes: string[] = []

  for (const m of SEED_CAST) {
    const { data: profile } = await admin
      .from('profiles')
      .select(
        'id, role, is_suspended, cnic_verified_at, address_verified_at, verification_state, profile_completion',
      )
      .eq('email', m.email)
      .maybeSingle()
    if (!profile) {
      changes.push(`SKIP ${m.key}: no account`)
      continue
    }
    const id = profile.id as string

    // --- subscriptions: exactly one active row of the intended plan, or none.
    const { data: subs } = await admin
      .from('subscriptions')
      .select('id, plan_code, status, expires_at')
      .eq('user_id', id)

    const wanted = m.plan
    const activeOrPaused = (subs ?? []).filter((s) => s.status === 'active' || s.status === 'paused')
    const correctActive = activeOrPaused.filter(
      (s) => s.status === 'active' && s.plan_code === wanted,
    )
    const wrong = activeOrPaused.filter(
      (s) => !(s.status === 'active' && s.plan_code === wanted),
    )

    // Cancel anything that should not be running (wrong plan, or any plan when
    // the member should have none, or a duplicate of the right one).
    const toCancel =
      wanted === null
        ? activeOrPaused
        : [...wrong, ...correctActive.slice(1)] // keep at most one correct active

    for (const s of toCancel) {
      changes.push(`${m.key}: cancel ${s.plan_code}/${s.status}`)
      if (apply) {
        await admin.from('subscriptions').update({ status: 'cancelled' }).eq('id', s.id)
      }
    }

    if (wanted && correctActive.length === 0) {
      changes.push(`${m.key}: activate ${wanted}`)
      if (apply) {
        const now = new Date()
        const { error } = await admin.from('subscriptions').insert({
          user_id: id,
          plan_code: wanted,
          starts_at: now.toISOString(),
          expires_at: new Date(now.getTime() + THIRTY_DAYS).toISOString(),
          status: 'active',
          source: 'admin_grant',
          note: 'seed cast reset',
        })
        if (error) die(`insert sub for ${m.key}: ${error.message}`)
      }
    }

    // --- tutor verification + suspension
    if (m.role === 'tutor') {
      const { data: tp } = await admin
        .from('tutor_profiles')
        .select('verification_status')
        .eq('id', id)
        .maybeSingle()
      if (m.verification && tp?.verification_status !== m.verification) {
        changes.push(`${m.key}: verification ${tp?.verification_status} -> ${m.verification}`)
        if (apply) {
          await admin
            .from('tutor_profiles')
            .update({ verification_status: m.verification })
            .eq('id', id)
        }
      }
      const wantSusp = !!m.suspended
      if (!!profile.is_suspended !== wantSusp) {
        changes.push(`${m.key}: is_suspended ${profile.is_suspended} -> ${wantSusp}`)
        if (apply) {
          await admin.from('profiles').update({ is_suspended: wantSusp }).eq('id', id)
        }
      }

      // The denormalised Featured flag is a cache of the plan (applyPlanFlags /
      // the expiry sweep own it in the app). Reconcile it so a tutor dropped
      // off Featured by this reset does not keep the gold tag in browse.
      const { data: tp2 } = await admin
        .from('tutor_profiles')
        .select('is_featured')
        .eq('id', id)
        .maybeSingle()
      const wantFeatured = m.plan === 'featured'
      if (!!tp2?.is_featured !== wantFeatured) {
        changes.push(`${m.key}: is_featured ${tp2?.is_featured} -> ${wantFeatured}`)
        if (apply) {
          await admin.from('tutor_profiles').update({ is_featured: wantFeatured }).eq('id', id)
        }
      }

      // The identity line reads profiles.cnic_verified_at. A seed tutor made
      // 'verified' on tutor_profiles never had it set, so the line said "Not
      // submitted" beside the badges. Set it to match the cast's identity
      // intent (a verified tutor's identity is approved). Idempotent: only
      // moves when the boolean differs, so a re-run does not re-stamp the date.
      const wantIdentity = expectedIdentity(m)
      const hasCnic = !!profile.cnic_verified_at
      if (hasCnic !== wantIdentity.verified) {
        changes.push(`${m.key}: cnic_verified_at ${hasCnic} -> ${wantIdentity.verified}`)
        if (apply) {
          await admin
            .from('profiles')
            .update({ cnic_verified_at: wantIdentity.verified ? new Date().toISOString() : null })
            .eq('id', id)
        }
      }
    }

    // --- parent CNIC + address verification (the free verified tier)
    if (m.role === 'parent' && m.parentVerified !== undefined) {
      const isVerified = !!profile.cnic_verified_at && !!profile.address_verified_at
      if (isVerified !== m.parentVerified) {
        changes.push(`${m.key}: parentVerified ${isVerified} -> ${m.parentVerified}`)
        if (apply) {
          const stamp = m.parentVerified ? new Date().toISOString() : null
          await admin
            .from('profiles')
            .update({ cnic_verified_at: stamp, address_verified_at: stamp })
            .eq('id', id)
        }
      }
    }

    // --- verification_state, for both roles. It is the other column the
    // identity line reads, and it must agree with cnic_verified_at: 'approved'
    // for a verified member, 'none' otherwise. This also clears the stale
    // 'approved' on seed+unverified-zain, an unverified parent whose state
    // column was left set by an earlier run.
    const wantState = expectedIdentity(m).verificationState
    if ((profile.verification_state ?? 'none') !== wantState) {
      changes.push(`${m.key}: verification_state ${profile.verification_state} -> ${wantState}`)
      if (apply) {
        await admin.from('profiles').update({ verification_state: wantState }).eq('id', id)
      }
    }

    // --- completion is DERIVED, never pinned. Writing profile_completion here
    // would invent a percentage the checklist did not earn -- the exact mistake
    // the fabricated-credential cleanup was about. If a cast member the cast
    // expects at 100% has drifted below, that is a real content gap to fix with
    // recompute-completion, not to paper over. Warn, do not write.
    if (m.completion !== undefined && (profile.profile_completion ?? 0) !== m.completion) {
      changes.push(
        `${m.key}: WARN completion is ${profile.profile_completion}, cast expects ${m.completion} (not written — completion is derived)`,
      )
    }
  }

  if (changes.length === 0) {
    console.log('Seed cast already matches intent. Nothing to do.')
  } else {
    console.log((apply ? 'Applied:' : 'Would change:') + '\n  ' + changes.join('\n  '))
  }
}

main().catch((e) => die(String(e?.stack || e)))
