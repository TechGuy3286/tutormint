/**
 * scripts/apply-aqsa-role.ts  (PR106-H2 §3, one-off)
 *
 * Change Aqsa Mughal (designmugahl@gmail.com) from admin → tuitions_staff,
 * reproducing EXACTLY the three writes the Team screen's changeStaffRole()
 * performs: the profile update, ONE admin_audit_log row (action
 * 'staff.role_change', detail {from,to,email}), and the member-timeline event
 * 'staff_role_changed'. The owner (techguy3286@gmail.com) is the actor.
 *
 * A standalone service-role client is used (not lib/supabase/admin, which pulls
 * `server-only` and cannot load under tsx) — the table inserts match the helper
 * shapes byte-for-byte, so the audited result is identical.
 *
 * Dry-run by default; pass --apply to write.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const TARGET_EMAIL = 'designmugahl@gmail.com'
const OWNER_EMAIL = 'techguy3286@gmail.com'
const NEW_ROLE = 'tuitions_staff'

function loadEnv(): void {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* optional */
  }
}

async function main() {
  loadEnv()
  const apply = process.argv.includes('--apply')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: owner } = await admin
    .from('profiles').select('id, email, role, admin_role').ilike('email', OWNER_EMAIL).maybeSingle()
  if (!owner || owner.admin_role !== 'owner') throw new Error('Owner account not found / not owner.')

  const { data: target } = await admin
    .from('profiles').select('id, email, role, admin_role').ilike('email', TARGET_EMAIL).maybeSingle()
  if (!target) throw new Error(`Target ${TARGET_EMAIL} not found.`)
  if (target.role !== 'admin') throw new Error('Target is not a staff account.')

  const from = target.admin_role as string
  console.log('BEFORE:', { id: target.id, email: target.email, role: target.role, admin_role: from })

  if (from === NEW_ROLE) { console.log('Already tuitions_staff — nothing to do.'); return }
  if (!apply) { console.log(`DRY RUN — would set '${from}' → '${NEW_ROLE}' + one audit entry. Re-run with --apply.`); return }

  const { error: upErr } = await admin.from('profiles').update({ admin_role: NEW_ROLE }).eq('id', target.id)
  if (upErr) throw new Error(`Update failed: ${upErr.message}`)

  // logAdminAction() shape — one append-only entry.
  const { error: auditErr } = await admin.from('admin_audit_log').insert({
    actor_id: owner.id,
    actor_role: 'owner',
    actor_email: owner.email,
    action: 'staff.role_change',
    target_type: 'profile',
    target_id: target.id,
    detail: { from, to: NEW_ROLE, email: target.email },
  })
  if (auditErr) throw new Error(`Audit insert failed: ${auditErr.message}`)

  // logActivity() shape — the member timeline event.
  const { error: actErr } = await admin.from('user_activity_log').insert({
    user_id: target.id,
    event: 'staff_role_changed',
    target_type: 'profile',
    target_id: target.id,
    meta: { from, to: NEW_ROLE },
  })
  if (actErr) console.warn(`(timeline insert warning: ${actErr.message})`)

  const { data: after } = await admin
    .from('profiles').select('id, email, role, admin_role').eq('id', target.id).maybeSingle()
  console.log('AFTER: ', after)
  console.log('Done — one staff.role_change audit entry by', owner.email)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
