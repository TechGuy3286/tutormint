/**
 * scripts/reset-mfa.ts — the manual two-factor recovery of last resort (PR49 §2).
 *
 *   npx tsx scripts/reset-mfa.ts <email>
 *
 * WHEN. There is no in-app route for the OWNER to recover if they lose BOTH
 * their phone AND their backup codes — by design, nobody can reset the owner
 * (the Team screen is owner-only, and they cannot reach it without 2FA). This
 * script is that recovery: run with the service-role key (SUPABASE_SERVICE_ROLE_KEY
 * in .env.local), it deletes the account's authenticator factors and its backup
 * codes, so the owner signs in with their password and sets up a fresh
 * authenticator at their next visit. It also works for any staff member.
 *
 * It NEVER changes a password or grants a role — it only clears two-factor. Read
 * only what it prints; it names the account it is about to reset and asks for the
 * project ref before doing anything.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

function env(): Record<string, string> {
  const out: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=')
      if (i < 0 || line.trimStart().startsWith('#')) continue
      const k = line.slice(0, i).trim()
      if (!out[k]) out[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* optional */ }
  return out
}

async function main() {
  const email = process.argv[2]
  if (!email) { console.error('Usage: npx tsx scripts/reset-mfa.ts <email>'); process.exit(1) }

  const e = env()
  const url = e.NEXT_PUBLIC_SUPABASE_URL
  const key = e.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1) }
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? '(unknown)'
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: prof } = await admin.from('profiles').select('id, full_name, role, admin_role').eq('email', email).maybeSingle()
  if (!prof) { console.error(`No account with email ${email}.`); process.exit(1) }
  console.log(`About to reset two-factor for: ${prof.full_name} <${email}> (role ${prof.role}${prof.admin_role ? '/' + prof.admin_role : ''}) on project ${ref}.`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const typed = await rl.question(`Type the project ref (${ref}) to confirm: `)
  await rl.close()
  if (typed.trim() !== ref) { console.error('Ref did not match. Nothing changed.'); process.exit(1) }

  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: prof.id as string })
  for (const f of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: prof.id as string })
    console.log(`  deleted factor ${f.id} (${f.factor_type})`)
  }
  const { count } = await admin.from('admin_backup_codes').delete({ count: 'exact' }).eq('user_id', prof.id)
  console.log(`  deleted ${count ?? 0} backup codes`)
  console.log('Done. They sign in with their password and set up a fresh authenticator.')
}

main().catch((err) => { console.error(err); process.exit(1) })
