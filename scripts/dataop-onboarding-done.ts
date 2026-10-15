/**
 * scripts/dataop-onboarding-done.ts — one-time correction (owner, 15 Oct 2026).
 *
 * "Onboarding done" (tutor_profiles.onboarded_at) was never written for tutors
 * who finished the new onboarding flow and went on to payment (the flag was set
 * only by a leave button they never pressed). This sets it for EVERY real tutor
 * who has genuinely answered every required step under today's rules
 * (lib/tutorFlow onboardingStepsComplete — the same rule the server now uses),
 * and for nobody else. One Audit log row per tutor.
 *
 * The date written is the tutor's last onboarding action (their newest
 * profile / subjects / document / mobile event), so the daily funnel counts
 * them on the day they finished, not today. Nothing else changes.
 *
 * It also LISTS (never changes):
 *   • paid tutors who still have steps missing, and what each is missing;
 *   • tutors already marked done although a step is missing today;
 *   • what the "Contact" stop is made of (WhatsApp / tagline / bio).
 *
 *   npx tsx --env-file=.env.local scripts/dataop-onboarding-done.ts           (dry run, writes nothing)
 *   npx tsx --env-file=.env.local scripts/dataop-onboarding-done.ts --apply
 * Names as initials and mobiles masked in the output.
 */
import { createClient } from '@supabase/supabase-js'
import { flowFactsByTutor } from '../lib/onboardingStop'
import { onboardingStepsComplete, stepDone } from '../lib/tutorFlow'
import { missingSummary } from '../lib/onboarding/missingItems'
import { pageAll } from '../lib/pageAll'

const ACTOR = 'system: onboarding done (15 Oct 2026)'
const ONBOARDING_EVENTS = ['profile_updated', 'subjects_changed', 'document_uploaded', 'otp_verified', 'registered']
const initials = (n: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('')
const mask = (m: string | null) => (m ? `${m.slice(0, 4)}•••${m.slice(-2)}` : '—')

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const ps = await pageAll((a, b) =>
    admin
      .from('profiles')
      .select('id, full_name, phone_number, admin_role, is_seed, is_team_account, is_test_name, hidden_from_public, is_banned')
      .eq('role', 'tutor')
      .order('id')
      .range(a, b),
  )
  const real = ps.filter((p) => !p.admin_role && !p.is_seed && !p.is_team_account && !p.is_test_name && !p.hidden_from_public && !p.is_banned)
  const byId = new Map(real.map((p) => [p.id as string, p]))
  const ids = [...byId.keys()]
  const tps = await pageAll((a, b) => admin.from('tutor_profiles').select('id, onboarded_at, verified_fee_paid_at, updated_at').order('id').range(a, b))
  const tp = new Map(tps.map((t) => [t.id as string, t]))
  const facts = await flowFactsByTutor(admin, ids)

  const toStamp: string[] = []
  const paidMissing: { id: string; missing: string[] }[] = []
  const doneButMissing: { id: string; missing: string[] }[] = []
  const contact = { whatsapp: 0, tagline: 0, bio: 0, n: 0 }
  for (const id of ids) {
    const f = facts.get(id)
    const t = tp.get(id)
    if (!f || !t) continue
    const complete = onboardingStepsComplete(f)
    const missing = missingSummary(f).missing.map((m) => m.label)
    if (!t.onboarded_at && complete) toStamp.push(id)
    if (t.verified_fee_paid_at && !complete) paidMissing.push({ id, missing })
    if (t.onboarded_at && !complete) doneButMissing.push({ id, missing })
    if (f.phoneVerified && !stepDone(f, 'contact')) {
      contact.n++
      if (!(f.whatsapp ?? '').trim()) contact.whatsapp++
      if (!(f.headline ?? '').trim()) contact.tagline++
      if (!(f.bio ?? '').trim()) contact.bio++
    }
  }

  // The date each tutor finished: their newest onboarding action.
  const finishedAt = new Map<string, string>()
  for (const id of toStamp) {
    const { data } = await admin
      .from('user_activity_log')
      .select('created_at')
      .eq('user_id', id)
      .in('event', ONBOARDING_EVENTS)
      .order('created_at', { ascending: false })
      .limit(1)
    finishedAt.set(id, (data?.[0]?.created_at as string) ?? (tp.get(id)!.updated_at as string) ?? new Date().toISOString())
  }

  const who = (id: string) => `${initials(byId.get(id)?.full_name as string)} ${mask(byId.get(id)?.phone_number as string)} (${id.slice(0, 8)})`
  console.log(`real tutors: ${ids.length}`)
  console.log(`\nTO MARK "onboarding done" (every required step answered, flag empty): ${toStamp.length}`)
  for (const id of toStamp) console.log(`  ${who(id)} · paid: ${tp.get(id)!.verified_fee_paid_at ? 'yes' : 'no'} · finished ${finishedAt.get(id)!.slice(0, 16)} UTC`)
  console.log(`\nPAID BUT STEPS MISSING: ${paidMissing.length}`)
  for (const r of paidMissing) console.log(`  ${who(r.id)} · missing: ${r.missing.join(', ')}`)
  console.log(`\nALREADY MARKED DONE BUT A STEP IS MISSING TODAY (listed only, not changed): ${doneButMissing.length}`)
  for (const r of doneButMissing) console.log(`  ${who(r.id)} · missing: ${r.missing.join(', ')}`)
  console.log(`\nCONTACT step not done (mobile verified): ${contact.n} · no WhatsApp ${contact.whatsapp} · no tagline ${contact.tagline} · no bio ${contact.bio}`)

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    return
  }
  let done = 0
  for (const id of toStamp) {
    const at = finishedAt.get(id)!
    const { data: updated, error } = await admin
      .from('tutor_profiles')
      .update({ onboarded_at: at })
      .eq('id', id)
      .is('onboarded_at', null)
      .select('id')
    if (error) {
      console.error('  failed', id.slice(0, 8), error.message)
      continue
    }
    if ((updated ?? []).length === 0) continue
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: ACTOR,
      actor_role: 'system',
      action: 'tutor.onboarding_done',
      target_type: 'member',
      target_id: id,
      detail: {
        before: 'Onboarding done: not set',
        after: `Onboarding done: ${at}`,
        reason: 'Every required onboarding step answered; the flag was never written by the new flow',
        dateFrom: 'last onboarding action',
        dataop: 'onboarding-done',
      },
    })
    await admin.from('user_activity_log').insert({ user_id: id, event: 'onboarding_done', target_type: 'tutor', target_id: id, meta: { via: 'correction' }, created_at: at })
    done++
  }
  console.log(`\nmarked: ${done} of ${toStamp.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
