/**
 * scripts/report-paid-completion.ts — READ-ONLY.
 *
 * Owner, 4 Nov 2026 (Part A): for every PAID tutor (Verification Fee paid,
 * real account) under 100% stored completion, what is missing — counted per
 * item — under (a) the stored 15-item checklist (lib/profileChecklist) and
 * (b) the onboarding "What's missing" list (lib/onboarding/missingItems).
 * Then how many would be at 100% under the shared rule (lib/profileRequired).
 * Also the stored profile_completion distribution for every member.
 *   npx tsx --env-file=.env.local scripts/report-paid-completion.ts
 * Counts only. Nothing is written.
 */
import { createClient } from '@supabase/supabase-js'
import { flowFactsByTutor } from '../lib/onboardingStop'
import { missingSummary } from '../lib/onboarding/missingItems'
import { calculateTutorCompletion } from '../lib/profileChecklist'
import { pageAll } from '../lib/pageAll'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const profiles = await pageAll<Record<string, unknown>>((from, to) =>
    admin
      .from('profiles')
      .select('id, role, admin_role, is_seed, is_team_account, is_test_name, hidden_from_public, profile_completion, full_name, city, email, cnic_number, cnic_image_path, phone_verified_at')
      .order('id')
      .range(from, to) as never,
  )
  const dist = (rows: Record<string, unknown>[]) => {
    const b = new Map<string, number>()
    for (const r of rows) {
      const p = Number(r.profile_completion ?? 0)
      const k = p >= 100 ? '100' : p >= 90 ? '90-99' : p >= 75 ? '75-89' : p >= 50 ? '50-74' : p >= 25 ? '25-49' : '0-24'
      b.set(k, (b.get(k) ?? 0) + 1)
    }
    return Object.fromEntries([...b].sort())
  }
  const real = profiles.filter((p) => !p.admin_role && !p.is_seed && !p.is_team_account && !p.is_test_name && !p.hidden_from_public)
  console.log('Stored completion — tutors:', JSON.stringify(dist(real.filter((p) => p.role === 'tutor'))))
  console.log('Stored completion — parents:', JSON.stringify(dist(real.filter((p) => p.role !== 'tutor' && p.role !== 'admin'))))

  const tutors = real.filter((p) => p.role === 'tutor')
  const ids = tutors.map((p) => p.id as string)
  const facts = new Map<string, Awaited<ReturnType<typeof flowFactsByTutor>> extends Map<string, infer V> ? V : never>()
  for (let i = 0; i < ids.length; i += 80) for (const [k, v] of await flowFactsByTutor(admin, ids.slice(i, i + 80))) facts.set(k, v)

  const paid = tutors.filter((p) => facts.get(p.id as string)?.feePaid)
  const under = paid.filter((p) => Number(p.profile_completion ?? 0) < 100)
  console.log(`\nPaid real tutors: ${paid.length}; stored under 100%: ${under.length}`)
  console.log('Stored % of paid tutors:', JSON.stringify(dist(paid)))
  const at = new Map<number, number>()
  for (const p of under) at.set(Number(p.profile_completion ?? 0), (at.get(Number(p.profile_completion ?? 0)) ?? 0) + 1)
  console.log('Exact stored % (under 100):', JSON.stringify(Object.fromEntries([...at].sort((a, b) => b[0] - a[0]))))

  const checklistMissing = new Map<string, number>()
  const onboardingMissing = new Map<string, number>()
  let liveChecklist100 = 0
  let onboarding100 = 0
  for (const p of under) {
    const f = facts.get(p.id as string)!
    const c = calculateTutorCompletion({
      profile: p as never,
      tutorProfile: {
        gender: f.gender, area: f.area, avatar_url: f.avatarUrl, headline: f.headline, bio: f.bio,
        experience_years: f.experienceYears, hourly_rate_pkr: f.hourlyRate, job_types: f.jobTypes,
        degrees: f.degreesCount > 0 ? ['x'] : [],
      },
      subjectCount: f.subjectCount,
      feePaid: f.feePaid,
    })
    if (c.percent === 100) liveChecklist100++
    for (const m of c.missing) checklistMissing.set(m.label, (checklistMissing.get(m.label) ?? 0) + 1)
    const s = missingSummary(f)
    if (s.missing.length === 0) onboarding100++
    for (const m of s.missing) onboardingMissing.set(m.label, (onboardingMissing.get(m.label) ?? 0) + 1)
  }
  // Every candidate item, counted across the paid tutors under 100% (stored).
  const vids = new Map<string, string | null>()
  const certs = new Set<string>()
  const uIds = under.map((p) => p.id as string)
  for (let i = 0; i < uIds.length; i += 100) {
    const { data } = await admin.from('tutor_profiles').select('id, video_youtube_id').in('id', uIds.slice(i, i + 100))
    for (const r of data ?? []) vids.set(r.id as string, (r.video_youtube_id as string | null) ?? null)
    const { data: d } = await admin.from('user_documents').select('user_id').eq('kind', 'degree').eq('status', 'active').in('user_id', uIds.slice(i, i + 100))
    for (const r of d ?? []) certs.add(r.user_id as string)
  }
  const { hasRealEmail } = await import('../lib/profileChecklist')
  const cand = new Map<string, number>()
  const bump = (k: string) => cand.set(k, (cand.get(k) ?? 0) + 1)
  for (const p of under) {
    const f = facts.get(p.id as string)!
    if (!hasRealEmail(p.email as string | null)) bump('Email (real address)')
    if (!vids.get(p.id as string)) bump('Intro video')
    if (!certs.has(p.id as string)) bump('Degree certificate image')
    if (f.degreesCount === 0) bump('Degree (typed)')
    if (f.availabilityCount === 0) bump('Availability')
    if (!f.whatsapp?.trim()) bump('WhatsApp number')
    if (f.experienceYears == null) bump('Experience (not answered)')
    if (f.experienceYears === 0) bump('Experience = "New to teaching" (0)')
    if (!f.headline?.trim()) bump('Tagline')
    if (!f.bio?.trim()) bump('About you')
    if (!f.selfieDone) bump('Selfie')
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join('\n')
  console.log(`\nEvery candidate item not done (paid, stored under 100%, n=${under.length}):`)
  console.log(sorted(cand))
  console.log(`\n(a) Stored 15-item checklist, recomputed live — reach 100% now: ${liveChecklist100} of ${under.length}`)
  console.log(sorted(checklistMissing) || '  (nothing missing)')
  console.log(`\n(b) Onboarding "What's missing" list — complete: ${onboarding100} of ${under.length}`)
  console.log(sorted(onboardingMissing) || '  (nothing missing)')
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
