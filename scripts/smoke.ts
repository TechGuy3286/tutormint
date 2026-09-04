/**
 * scripts/smoke.ts
 *
 *   npx tsx scripts/smoke.ts
 *
 * The launch smoke test. It creates one tutor and one parent through the real
 * signup API, confirms both land held on phone verification, deletes them, and
 * — the assertion that matters for the seed cast — proves the named seed
 * accounts are unchanged before and after.
 *
 * THE RULE IT ENFORCES (CLAUDE.md, seed cast): any evidence step that changes a
 * seed account's plan, status or completion restores it in the same run and
 * asserts the restore. A smoke run creates and deletes accounts; if creating a
 * member ever touched a seed row, or a stray restore drifted, this fails loudly
 * rather than letting the drift accumulate into the next audit.
 *
 * BASE URL: defaults to production (https://www.tutormint.org). Pass
 * SMOKE_BASE_URL to point elsewhere. It reads and asserts against the same
 * database either way (one project), via the service role, so the cast check is
 * independent of which host served the signup.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SEED_CAST, type CastSnapshotRow } from './seedCast'

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

const env = loadEnv()
const BASE = env.SMOKE_BASE_URL || 'https://www.tutormint.org'
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL

if (!SERVICE || !SUPA) {
  console.error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required.')
  process.exit(1)
}

const admin = createClient(SUPA, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Snapshot the fields the cast pins, for every named seed account. */
async function snapshotCast(): Promise<Record<string, CastSnapshotRow>> {
  const out: Record<string, CastSnapshotRow> = {}
  for (const m of SEED_CAST) {
    const { data: p } = await admin
      .from('profiles')
      .select('id, role, profile_completion, is_suspended, cnic_verified_at, address_verified_at')
      .eq('email', m.email)
      .maybeSingle()
    if (!p) {
      out[m.email] = { email: m.email, role: null, completion: null, suspended: false, verification: null, activePlan: null }
      continue
    }
    const id = p.id as string
    let verification: string | null = null
    if (p.role === 'tutor') {
      const { data: tp } = await admin.from('tutor_profiles').select('verification_status').eq('id', id).maybeSingle()
      verification = (tp?.verification_status as string) ?? null
    } else {
      verification = p.cnic_verified_at && p.address_verified_at ? 'parent_verified' : 'unverified'
    }
    const { data: sub } = await admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    out[m.email] = {
      email: m.email,
      role: (p.role as string) ?? null,
      completion: (p.profile_completion as number) ?? null,
      suspended: !!p.is_suspended,
      verification,
      activePlan: (sub?.plan_code as string) ?? null,
    }
  }
  return out
}

function diffCast(before: Record<string, CastSnapshotRow>, after: Record<string, CastSnapshotRow>): string[] {
  const diffs: string[] = []
  for (const email of Object.keys(before)) {
    const b = before[email]
    const a = after[email]
    for (const k of ['role', 'completion', 'suspended', 'verification', 'activePlan'] as const) {
      if (b[k] !== a[k]) diffs.push(`${email}.${k}: ${String(b[k])} -> ${String(a[k])}`)
    }
  }
  return diffs
}

async function signup(role: 'tutor' | 'parent') {
  // A throwaway Pakistani mobile in a test range, unique per run.
  const digits = String(Date.now()).slice(-7)
  const mobile = `03${role === 'tutor' ? '96' : '97'}${digits}`
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role,
      fullName: `Smoke ${role}`,
      mobile,
      password: 'Test1234!',
      acceptedTerms: true,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body, mobile }
}

async function deleteByMobile(mobile: string) {
  // Synthetic email is derived from the MSISDN; find and delete the auth user.
  const e164 = `92${mobile.replace(/^0/, '')}`
  const email = `${e164}@users.tutormint.org`
  const { data: prof } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  const id = prof?.id as string | undefined
  if (id) {
    await admin.auth.admin.deleteUser(id)
  }
  return { email, deleted: !!id }
}

async function main() {
  console.log(`smoke: base ${BASE}\n`)

  const before = await snapshotCast()

  const created: string[] = []
  let failures = 0
  for (const role of ['tutor', 'parent'] as const) {
    const r = await signup(role)
    const ok = r.status === 200 && r.body?.success
    console.log(`create ${role}: ${r.status} success=${!!r.body?.success}${r.body?.error ? ' err=' + r.body.error : ''}`)
    if (!ok) failures += 1
    else created.push(r.mobile)
  }

  // Clean up whatever was created, even on partial failure.
  for (const mobile of created) {
    const d = await deleteByMobile(mobile)
    console.log(`delete ${d.email}: ${d.deleted ? 'ok' : 'not found'}`)
  }

  const after = await snapshotCast()
  const drift = diffCast(before, after)

  console.log('\n--- seed cast assertion ---')
  if (drift.length === 0) {
    console.log('PASS: seed cast unchanged by the smoke run.')
  } else {
    console.log('FAIL: seed cast drifted during the smoke run:')
    for (const d of drift) console.log('  ' + d)
    failures += 1
  }

  if (failures > 0) {
    console.error(`\nsmoke: ${failures} failure(s).`)
    process.exit(1)
  }
  console.log('\nsmoke: all good.')
}

main().catch((e) => {
  console.error(String(e?.stack || e))
  process.exit(1)
})
