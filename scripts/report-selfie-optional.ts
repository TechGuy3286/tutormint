/**
 * scripts/report-selfie-optional.ts — READ-ONLY.
 *
 * Owner, 12 Nov 2026: the selfie became optional. From the same live data, the
 * OLD rule (selfie required) against the NEW rule (CNIC + profile photo):
 *   - tutors stuck at the selfie step who can now continue;
 *   - tutors moving into "Waiting for approval" and "Approved, fee pending";
 *   - tutors newly eligible for Google indexing and the status image;
 *   - the People stage counts under the new rule.
 * Counts only — never a name, phone, email, CNIC number or file address.
 * Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-selfie-optional.ts
 */
import { createClient } from '@supabase/supabase-js'
import { flowFactsByTutor } from '../lib/onboardingStop'
import { NEW_FLOW_ORDER, firstMissingStep, onboardingStepsComplete, stepDoneIn, type FlowFacts } from '../lib/tutorFlow'
import { tutorCardStatuses } from '../lib/tutorDocQueueCore'
import { itemState } from '../lib/tutorDocSummaryCore'
import { pipelineStage, WAITING_MIN_COMPLETION, type DocState, type PipeStage } from '../lib/tutorPipelineCore'
import { tutorProfileIndexable } from '../lib/seo/indexable'
import { socialEligible } from '../lib/social/eligibilityCore'
import { deriveCnicStatus } from '../lib/cnicStatus'
import { pageAll, pageAllIn } from '../lib/pageAll'

type P = Record<string, unknown> & { id: string }

/** The stage rule as it was before 12 Nov 2026 (all three documents). */
function oldStage(d: { cnic: DocState; photo: DocState; selfie: DocState }, feePaid: boolean, completion: number): PipeStage {
  if (feePaid) return 'paid'
  const s = [d.cnic, d.photo, d.selfie]
  if (s.includes('rejected')) return 'rejected'
  if (!s.includes('none') && s.includes('waiting') && completion >= WAITING_MIN_COMPLETION) return 'waiting'
  if (s.includes('none') || s.includes('waiting')) return 'missing'
  return 'approved'
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const profiles = await pageAll<P>((from, to) =>
    admin
      .from('profiles')
      .select('id, role, is_seed, is_team_account, is_test_name, hidden_from_public, is_suspended, is_banned, paused_by_user_at, profile_completion, verification_state, verification_rejection_reason, cnic_verified_at, cnic_number, cnic_image_path, avatar_url, profile_pic_status, profile_pic_reason, profile_pic_rereview_at, selfie_status, selfie_reason, name_rereview_at')
      .eq('role', 'tutor')
      .order('id')
      .range(from, to) as never,
  )
  const real = profiles.filter((p) => !p.is_seed && !p.is_team_account && !p.is_test_name && !p.hidden_from_public && !p.is_banned)
  const ids = real.map((p) => p.id)
  const tps = await pageAllIn<P, string>(ids, (part, from, to) => admin.from('tutor_profiles').select('id, verified_fee_paid_at, under_review, gender, show_avatar').in('id', part).order('id').range(from, to) as never)
  const tp = new Map(tps.map((t) => [t.id, t]))
  const docs = await pageAllIn<P, string>(ids, (part, from, to) =>
    admin.from('user_documents').select('id, user_id, kind, status').in('kind', ['selfie', 'cnic']).in('status', ['active', 'review']).in('user_id', part).order('id').range(from, to) as never,
  )
  const has = (uid: string, kind: string, status: string) => docs.some((d) => d.user_id === uid && d.kind === kind && d.status === status)
  const facts = new Map<string, FlowFacts>()
  for (let i = 0; i < ids.length; i += 80) for (const [k, v] of await flowFactsByTutor(admin, ids.slice(i, i + 80))) facts.set(k, v)

  const count = { real: real.length, stuckSelfie: 0, stuckSelfieNowDone: 0, intoWaiting: 0, intoApproved: 0, indexOld: 0, indexNew: 0, statusOld: 0, statusNew: 0, onboardOld: 0, onboardNew: 0 }
  const stagesOld: Record<string, number> = {}
  const stagesNew: Record<string, number> = {}
  for (const p of real) {
    const f = facts.get(p.id)
    const t = tp.get(p.id)
    const feePaid = !!t?.verified_fee_paid_at
    if (f && !p.is_suspended && !p.paused_by_user_at) {
      const oldFirst = NEW_FLOW_ORDER.find((k) => !stepDoneIn(f, k, NEW_FLOW_ORDER)) ?? null
      if (oldFirst === 'selfie') {
        count.stuckSelfie++
        if (firstMissingStep(f, NEW_FLOW_ORDER) !== 'selfie' && onboardingStepsComplete(f)) count.stuckSelfieNowDone++
      }
      const oldDone = f.phoneVerified && NEW_FLOW_ORDER.filter((k) => k !== 'verify').every((k) => stepDoneIn(f, k, NEW_FLOW_ORDER))
      if (oldDone) count.onboardOld++
      if (onboardingStepsComplete(f)) count.onboardNew++
    }
    const statuses = tutorCardStatuses({
      verification_state: p.verification_state as string | null,
      verification_rejection_reason: p.verification_rejection_reason as string | null,
      cnic_verified_at: p.cnic_verified_at as string | null,
      cnic_number: p.cnic_number as string | null,
      cnic_image_path: p.cnic_image_path as string | null,
      avatar_url: p.avatar_url as string | null,
      profile_pic_status: p.profile_pic_status as string | null,
      profile_pic_reason: p.profile_pic_reason as string | null,
      profile_pic_rereview_at: p.profile_pic_rereview_at as string | null,
      selfie_status: p.selfie_status as string | null,
      selfie_reason: p.selfie_reason as string | null,
      hasSelfieFile: has(p.id, 'selfie', 'active'),
      hasCnicFile: has(p.id, 'cnic', 'active'),
      hasCnicReview: has(p.id, 'cnic', 'review'),
      hasSelfieReview: has(p.id, 'selfie', 'review'),
    } as never)
    const d = { cnic: itemState(statuses.cnic), photo: itemState(statuses.profilePic), selfie: itemState(statuses.selfie) }
    const completion = Number(p.profile_completion ?? 0)
    if (!p.is_suspended) {
      const o = oldStage(d, feePaid, completion)
      const n = pipelineStage({ ...d, feePaid, completion })
      stagesOld[o] = (stagesOld[o] ?? 0) + 1
      stagesNew[n] = (stagesNew[n] ?? 0) + 1
      if (n === 'waiting' && o !== 'waiting') count.intoWaiting++
      if (n === 'approved' && o !== 'approved') count.intoApproved++
    }
    const cnicApproved = deriveCnicStatus(p as never) === 'approved'
    const photoApproved = String(p.profile_pic_status ?? '') === 'approved'
    const selfieApproved = String(p.selfie_status ?? '') === 'approved'
    const idx = { feePaid, cnicApproved, profilePicApproved: photoApproved, isSeed: false, underReview: !!t?.under_review }
    const okNew = !p.is_suspended && !p.paused_by_user_at && tutorProfileIndexable(idx)
    if (okNew) count.indexNew++
    if (okNew && selfieApproved) count.indexOld++
    const soc = { role: 'tutor', feePaid, cnicApproved, photoApproved, suspended: !!p.is_suspended, banned: false, selfPaused: !!p.paused_by_user_at }
    if (socialEligible(soc)) count.statusNew++
    if (socialEligible(soc) && selfieApproved) count.statusOld++
  }
  console.log(`real tutors: ${count.real}`)
  console.log(`stuck at the selfie step (old rule): ${count.stuckSelfie} — of those, onboarding now complete: ${count.stuckSelfieNowDone}; the rest continue to their next step`)
  console.log(`onboarding done: old ${count.onboardOld} → new ${count.onboardNew}`)
  console.log(`moved into Waiting for approval: ${count.intoWaiting}; into Approved, fee pending: ${count.intoApproved}`)
  console.log(`index rule (before the directory filter): old ${count.indexOld} → new ${count.indexNew} (+${count.indexNew - count.indexOld})`)
  console.log(`status image / social posts: old ${count.statusOld} → new ${count.statusNew} (+${count.statusNew - count.statusOld})`)
  const order = ['missing', 'waiting', 'rejected', 'approved', 'paid']
  console.log('stages old:', order.map((s) => `${s} ${stagesOld[s] ?? 0}`).join(' · '))
  console.log('stages new:', order.map((s) => `${s} ${stagesNew[s] ?? 0}`).join(' · '))
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : 'failed'); process.exit(1) })
