/**
 * scripts/provision-team-parent.ts
 *
 *   npx tsx scripts/provision-team-parent.ts                         # dry run: report state
 *   npx tsx scripts/provision-team-parent.ts --email=team@tutormint.org --apply
 *   npx tsx scripts/provision-team-parent.ts --mobile=03XXXXXXXXX     --apply
 *
 * Provisions the ONE team-operated TutorMint parent account that admin-posted
 * tuitions belong to (owner, 9 Sep 2026). It is a REAL parent account granted
 * the Featured parent plan, so applications, threads, shortlisting and hiring
 * all run through the ordinary parent flow with no special-casing — the whole
 * reason the recipient is a genuine account and not a synthetic row.
 *
 * YOU MUST SUPPLY A REAL IDENTIFIER THE TEAM CONTROLS. This script never invents
 * one:
 *   --email=<addr>   an inbox the team controls (so the account is recoverable
 *                    and someone can sign in to work applications). email_confirm
 *                    is set, so no confirmation mail is sent; the printed
 *                    temporary password (or a later password reset) is the way in.
 *   --mobile=<pk>    a mobile the team controls. Creates the synthetic
 *                    <msisdn>@users.tutormint.org login like a mobile signup, with
 *                    the phone gate OFF (the team is not made to pass /verify-phone).
 *
 * What it sets on the account so the ordinary parent flow works:
 *   profiles: role='parent', is_team_account=true, full_name='TutorMint',
 *     CNIC + address marked verified and profile_completion=100 (so the account
 *     may post and hire and its jobs carry the Featured tag), phone gate off.
 *   subscriptions: an active parent_featured row with a far-future expiry.
 *
 * Idempotent-ish and SAFE BY REFUSAL: it refuses if that email/mobile already has
 * an account, and refuses if a team account already exists (there is meant to be
 * exactly one). Run the dry run first; --apply writes. Production writes go
 * through guardWrites (take a backup first).
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { guardWrites, die } from './target'

const TEAM_FULL_NAME = 'TutorMint'
const TEAM_CITY = 'Lahore' // the registered-office city; display only
const FAR_FUTURE = '2099-12-31T00:00:00.000Z'

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

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(`--${name}=`.length).trim() : null
}

/** Pakistani mobile → E.164 digits (923001234567), matching lib/phone.ts. */
function toMsisdn(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, '')
  if (/^92\d{10}$/.test(d)) return d
  if (/^0\d{10}$/.test(d)) return `92${d.slice(1)}`
  if (/^\d{10}$/.test(d) && d.startsWith('3')) return `92${d}`
  return null
}

function tempPassword(): string {
  return `Tm-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}!`
}

async function main() {
  const env = loadEnv()
  const apply = process.argv.includes('--apply')

  const emailArg = arg('email')
  const mobileArg = arg('mobile')

  if (apply && !emailArg && !mobileArg) {
    die('Supply --email=<addr> or --mobile=<pk mobile>. This script never invents an identifier.')
  }
  if (emailArg && mobileArg) die('Supply either --email or --mobile, not both.')

  let email: string | null = null
  let phoneNumber = ''
  let synthetic = false
  if (emailArg) {
    email = emailArg.toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die('That does not look like an email address.')
  } else if (mobileArg) {
    const msisdn = toMsisdn(mobileArg)
    if (!msisdn) die('That does not look like a Pakistani mobile number.')
    email = `${msisdn}@users.tutormint.org`
    phoneNumber = msisdn
    synthetic = true
  }

  await guardWrites({
    scriptName: 'provision-team-parent -- create the team-operated TutorMint parent account',
    env,
    action: apply
      ? `Creates a parent account for ${email}, marks it the team account, grants parent_featured.`
      : 'Dry run only: reports whether a team account exists, writes nothing.',
    dryRun: !apply,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Is there already a team account?
  const { data: existingTeam } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .eq('is_team_account', true)
    .maybeSingle()

  if (existingTeam) {
    console.log(
      `A team account already exists: ${existingTeam.full_name} <${existingTeam.email}> (${existingTeam.id}).`,
    )
    console.log('There is meant to be exactly one. Nothing to do.')
    return
  }

  if (!apply) {
    console.log('No team account exists yet.')
    console.log('Pass --email=<addr> (or --mobile=<pk>) with --apply to provision it.')
    return
  }

  // Refuse to hijack an address/number that already has an account.
  const { data: clash } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email as string)
    .maybeSingle()
  if (clash) die(`${email} already has a ${clash.role} account. Choose a different identifier.`)

  // 1) The auth user. email_confirm so it is usable immediately and no mail goes
  //    out; for a synthetic (mobile) login the phone gate is left OFF below.
  const password = tempPassword()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email as string,
    password,
    email_confirm: true,
    user_metadata: { full_name: TEAM_FULL_NAME, role: 'parent' },
  })
  if (createErr || !created?.user) die(createErr?.message ?? 'Could not create the auth user.')
  const userId = created.user.id

  // 2) The profile. Upserted (belt-and-braces) whether or not the trigger fired:
  //    a real parent account, marked the team account, verified and complete so
  //    it may post and hire and its jobs carry the Featured tag.
  const now = new Date().toISOString()
  const { error: profErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      role: 'parent',
      account_type: 'parent',
      full_name: TEAM_FULL_NAME,
      email,
      phone_number: phoneNumber,
      city: TEAM_CITY,
      is_team_account: true,
      cnic_verified_at: now,
      address_verified_at: now,
      verification_state: 'approved',
      profile_completion: 100,
      phone_gate_required: false,
      // A non-bridge value: this account is team-operated, not proved via the
      // BRIDGE_OTP stopgap, so it must not be bridge-locked out of its plan.
      phone_verified_via: synthetic ? 'otp' : null,
      phone_verified_at: now,
    },
    { onConflict: 'id' },
  )
  if (profErr) {
    await admin.auth.admin.deleteUser(userId)
    die(`Could not write the profile: ${profErr.message}`)
  }

  // 3) The Featured parent plan. Active, far-future expiry.
  const { error: subErr } = await admin.from('subscriptions').insert({
    user_id: userId,
    plan_code: 'parent_featured',
    status: 'active',
    starts_at: now,
    expires_at: FAR_FUTURE,
    // subscriptions_source_check allows 'purchase' | 'admin_grant'.
    source: 'admin_grant',
    note: 'Team-operated TutorMint parent account (provision-team-parent.ts).',
  })
  if (subErr) die(`Account made, but granting parent_featured failed: ${subErr.message}`)

  // 4) Assert what we set.
  const [{ data: prof }, { data: sub }] = await Promise.all([
    admin.from('profiles').select('is_team_account, role, cnic_verified_at, address_verified_at, profile_completion').eq('id', userId).maybeSingle(),
    admin.from('subscriptions').select('plan_code, status').eq('user_id', userId).eq('status', 'active').maybeSingle(),
  ])
  if (!prof?.is_team_account) die('Assertion failed: is_team_account is not set.')
  if (sub?.plan_code !== 'parent_featured') die('Assertion failed: parent_featured is not active.')

  console.log('\n✓ Team parent account provisioned.')
  console.log(`  user id      : ${userId}`)
  console.log(`  login email  : ${email}${synthetic ? '  (synthetic — sign in with the mobile)' : ''}`)
  console.log(`  temp password: ${password}`)
  console.log(`  plan         : parent_featured (active, expires ${FAR_FUTURE})`)
  console.log('\n  Sign in once and change the password, OR (email accounts) use a')
  console.log('  password reset to the team inbox. Admin can now post team tuitions at')
  console.log('  /admin/jobs/new; the team works applications by signing into this account.\n')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
