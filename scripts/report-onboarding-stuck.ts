/**
 * scripts/report-onboarding-stuck.ts — READ-ONLY.
 *
 * For tutors who joined in the last 30 days: how many are stuck at each
 * onboarding step, by the SAME rule Admin → People shows ("Stopped at",
 * lib/onboardingStop). And, for every real tutor: how many profiles are
 * indexable today (lib/seo/indexable tutorProfileIndexable + in
 * tutor_directory) and which rule blocks the rest.
 *   npx tsx --env-file=.env.local scripts/report-onboarding-stuck.ts
 * Nothing is written.
 */
import { createClient } from '@supabase/supabase-js'
import { stoppedAtByTutor } from '../lib/onboardingStop'
import { tutorProfileIndexable } from '../lib/seo/indexable'
import { deriveCnicStatus } from '../lib/cnicStatus'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data: all } = await admin
    .from('profiles')
    .select('id, full_name, created_at, is_seed, is_team_account, is_banned, is_suspended, is_test_name, hidden_from_public, paused_by_user_at, verification_state, cnic_verified_at, cnic_number, cnic_image_path, profile_pic_status, selfie_status')
    .eq('role', 'tutor')
    .order('id')
    .range(0, 4999)
  const real = (all ?? []).filter((p) => !p.is_seed && !p.is_team_account && !p.is_banned && !p.is_suspended && !p.is_test_name && !p.hidden_from_public)
  const ids = real.map((p) => p.id as string)

  const tps: Record<string, { verified_fee_paid_at: string | null; onboarded_at: string | null; under_review: boolean | null }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('tutor_profiles').select('id, verified_fee_paid_at, onboarded_at, under_review').in('id', ids.slice(i, i + 200))
    for (const t of data ?? []) tps[t.id as string] = t as never
  }

  // --- stuck in the last 30 days -------------------------------------------
  const since = Date.now() - 30 * 24 * 3600_000
  const recent = real.filter((p) => new Date(p.created_at as string).getTime() >= since).map((p) => p.id as string)
  const stopped = new Map<string, string>()
  for (let i = 0; i < recent.length; i += 80) {
    for (const [k, v] of await stoppedAtByTutor(admin as never, recent.slice(i, i + 80))) stopped.set(k, v)
  }
  const byStep: Record<string, number> = {}
  for (const v of stopped.values()) byStep[v] = (byStep[v] ?? 0) + 1
  const sorted = Object.entries(byStep).sort((a, b) => b[1] - a[1])
  console.log(`Tutors joined in the last 30 days: ${recent.length}; with a step still to do: ${stopped.size}; every step done: ${recent.length - stopped.size}`)
  console.log('Stuck at:', sorted.map(([k, v]) => `${k} ${v}`).join(' · '))

  // --- indexable vs total ----------------------------------------------------
  const { data: dir } = await admin.from('tutor_directory').select('id').range(0, 4999)
  const inDirectory = new Set((dir ?? []).map((d) => d.id as string))
  const { data: listed } = await admin.rpc('listed_tutor_slugs').range(0, 4999)
  let indexable = 0
  const blocks: Record<string, number> = {}
  const firstBlock: Record<string, number> = {}
  for (const p of real) {
    const tp = tps[p.id as string]
    if (!tp) continue
    const facts = {
      feePaid: !!tp.verified_fee_paid_at,
      cnicApproved: deriveCnicStatus(p as never) === 'approved',
      profilePicApproved: p.profile_pic_status === 'approved',
      selfieApproved: p.selfie_status === 'approved',
      isSeed: false,
      underReview: !!tp.under_review || !!p.paused_by_user_at,
    }
    if (tutorProfileIndexable(facts) && inDirectory.has(p.id as string)) {
      indexable++
      continue
    }
    const why = [
      !facts.feePaid && 'Verification Fee not paid',
      !facts.cnicApproved && 'CNIC not approved',
      !facts.profilePicApproved && 'profile photo not approved',
      !facts.selfieApproved && 'selfie not approved',
      facts.underReview && 'under review or paused by the tutor',
      !inDirectory.has(p.id as string) && 'not in the directory (a rejected document, or delisted)',
    ].filter(Boolean) as string[]
    for (const w of why) blocks[w] = (blocks[w] ?? 0) + 1
    if (why[0]) firstBlock[why[0]] = (firstBlock[why[0]] ?? 0) + 1
  }
  console.log(`\nReal tutors: ${real.length}; indexable now: ${indexable}; sitemap (listed_tutor_slugs): ${(listed ?? []).length}`)
  console.log('Not indexable because (a tutor can fail several):', Object.entries(blocks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '))
  console.log('Only the fee missing (documents all approved):', real.filter((p) => { const tp = tps[p.id as string]; return tp && !tp.verified_fee_paid_at && deriveCnicStatus(p as never) === 'approved' && p.profile_pic_status === 'approved' && p.selfie_status === 'approved' }).length)
}

void main()
