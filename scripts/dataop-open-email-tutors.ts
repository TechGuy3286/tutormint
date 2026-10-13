/**
 * scripts/dataop-open-email-tutors.ts — one-time (owner, 13 Oct 2026).
 *
 * Email confirmation no longer blocks onboarding. Tutors who signed up with an
 * email BEFORE that change and never clicked their link cannot sign in at all.
 * This puts each of them in the new state:
 *   • the login system accepts their email and password (email_confirm = true);
 *   • profiles.email_pending_confirm = true — the dashboard reminder shows, and
 *     no email except our confirmation link goes to the address until they
 *     click it.
 * Nothing else about the account changes; nothing is deleted. Their password is
 * the one they chose. Parents are not touched. One Audit log row per account.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-open-email-tutors.ts            (lists, writes nothing)
 *   npx tsx --env-file=.env.local scripts/dataop-open-email-tutors.ts --apply
 */
import { createClient } from '@supabase/supabase-js'

const ACTOR = 'system: email tutors (13 Oct 2026)'

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const unconfirmed = new Map<string, string>()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data) throw error ?? new Error('listUsers failed')
    for (const u of data.users) {
      const email = (u.email ?? '').toLowerCase()
      if (!u.email_confirmed_at && email && !email.endsWith('@users.tutormint.org')) unconfirmed.set(u.id, email)
    }
    if (data.users.length < 1000) break
  }
  const ids = [...unconfirmed.keys()]
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, role, full_name, email, is_banned, is_suspended, is_seed, created_at').in('id', ids)
    : { data: [] as Record<string, unknown>[] }
  const tutors = (profiles ?? []).filter((p) => p.role === 'tutor' && !p.is_banned && !p.is_suspended && !p.is_seed)
  console.log(`unconfirmed email accounts: ${ids.length}; of them tutors to open: ${tutors.length}`)
  for (const t of tutors) console.log(`  ${String(t.id).slice(0, 8)}…  joined ${String(t.created_at).slice(0, 10)}`)
  if (!apply) {
    console.log('DRY RUN — nothing written. Re-run with --apply.')
    return
  }

  let done = 0
  for (const t of tutors) {
    const id = t.id as string
    // The flag first: if the second step failed, the account would still be
    // unable to sign in (as now) rather than signed in with mail going out.
    const { error: flagError } = await admin.from('profiles').update({ email_pending_confirm: true }).eq('id', id)
    if (flagError) {
      console.error('  flag failed', id.slice(0, 8), flagError.message)
      continue
    }
    const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true })
    if (error) {
      console.error('  auth update failed', id.slice(0, 8), error.message)
      await admin.from('profiles').update({ email_pending_confirm: false }).eq('id', id)
      continue
    }
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: ACTOR,
      actor_role: 'system',
      action: 'member.email_unblock',
      target_type: 'member',
      target_id: id,
      detail: { before: 'Email not confirmed — could not sign in', after: 'Can sign in; email confirmation pending (reminder shown)', dataop: 'open-email-tutors' },
    })
    done++
  }
  console.log(`opened: ${done} of ${tutors.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
