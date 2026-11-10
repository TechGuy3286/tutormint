/**
 * scripts/dataop-repair-doc-status.ts — one-time repair (owner, 10 Nov 2026).
 *
 * Some upload paths saved a CNIC image, a profile photo or a selfie without
 * setting its review status, so admin read "Not uploaded" over real files and
 * People counted those tutors as "Documents missing". This finds every member
 * whose file is on record while the status is empty / 'none', and sets it to
 * waiting (CNIC: verification_state 'submitted'; photo / selfie: 'pending').
 *
 * NEVER touches an approved or rejected status, or one already waiting — the
 * rule is lib/docUploadStatusCore repairPlanFor, and every write repeats it in
 * its own WHERE clause. Nothing is deleted. Prints COUNTS ONLY — never a name,
 * number, email, CNIC, file address or key.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-repair-doc-status.ts           (dry run, writes nothing)
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-repair-doc-status.ts --apply   (writes)
 */
import { createClient } from '@supabase/supabase-js'
import { pageAll } from '../lib/pageAll'
import { repairPlanFor, repairPatch, type RepairPlan } from '../lib/docUploadStatusCore'
import { tutorCardStatuses, type CardStatuses } from '../lib/tutorDocQueueCore'
import { tutorDocFactsFromRow, type TutorDocRow } from '../lib/tutorDocSummaryCore'
import { pipeDocsOf } from '../lib/tutorPipelineCardCore'
import { pipelineStage, type PipeStage } from '../lib/tutorPipelineCore'
import { tutorDocStatusesFromProfile } from '../lib/tutorDocStatus'
import { tutorVerifiedBadgeOk } from '../lib/badgeRule'

const ACTOR = 'system: document status repair (10 Nov 2026)'

type Row = TutorDocRow & {
  id: string
  role: string | null
  profile_completion: number | null
  is_seed: boolean | null
  is_test_name: boolean | null
  hidden_from_public: boolean | null
  is_team_account: boolean | null
  is_suspended: boolean | null
  is_banned: boolean | null
}

/** What People showed BEFORE this fix: an item the repair would set read as
 *  not uploaded (status 'none'). */
function storedStatuses(after: CardStatuses, plan: RepairPlan): CardStatuses {
  const none = (s: CardStatuses['cnic']) => ({ ...s, status: 'none' as const, rereview: false })
  return {
    cnic: plan.cnic ? none(after.cnic) : after.cnic,
    profilePic: plan.photo ? none(after.profilePic) : after.profilePic,
    selfie: plan.selfie ? none(after.selfie) : after.selfie,
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase URL / service key not set (use --env-file=.env.local).')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const profiles = (await pageAll((a, b) =>
    admin
      .from('profiles')
      .select(
        'id, role, profile_completion, is_seed, is_test_name, hidden_from_public, is_team_account, is_suspended, is_banned, verification_state, verification_rejection_reason, cnic_verified_at, cnic_number, cnic_image_path, avatar_url, profile_pic_status, profile_pic_reason, profile_pic_rereview_at, selfie_status, selfie_reason',
      )
      .in('role', ['tutor', 'parent'])
      .order('id')
      .range(a, b),
  )) as Row[]

  const docs = await pageAll((a, b) =>
    admin.from('user_documents').select('id, user_id, kind, status').in('kind', ['cnic', 'selfie']).in('status', ['active', 'review']).order('id').range(a, b),
  )
  const docsBy = new Map<string, { kind: string; status: string }[]>()
  for (const d of docs) {
    const l = docsBy.get(d.user_id as string) ?? []
    l.push({ kind: d.kind as string, status: d.status as string })
    docsBy.set(d.user_id as string, l)
  }

  const tps = await pageAll((a, b) => admin.from('tutor_profiles').select('id, verified_fee_paid_at').order('id').range(a, b))
  const feePaid = new Set(tps.filter((t) => !!t.verified_fee_paid_at).map((t) => t.id as string))

  const counts = {
    tutor: { cnic: 0, photo: 0, selfie: 0, members: 0 },
    parent: { cnic: 0, members: 0 },
  }
  const moves = new Map<string, number>()
  let movesReal = 0
  let badgeGain = 0
  const now = new Date().toISOString()
  const toWrite: { id: string; plan: RepairPlan }[] = []

  for (const p of profiles) {
    const mine = docsBy.get(p.id) ?? []
    const hasCnicFile = mine.some((d) => d.kind === 'cnic' && d.status === 'active')
    const hasSelfieFile = mine.some((d) => d.kind === 'selfie' && d.status === 'active')
    let plan = repairPlanFor({ ...p, hasCnicFile, hasSelfieFile })
    // Photo and selfie review exist for tutors only.
    if (p.role !== 'tutor') plan = { ...plan, photo: false, selfie: false }
    if (!plan.cnic && !plan.photo && !plan.selfie) continue
    toWrite.push({ id: p.id, plan })

    if (p.role === 'parent') {
      counts.parent.members++
      if (plan.cnic) counts.parent.cnic++
      continue
    }
    counts.tutor.members++
    if (plan.cnic) counts.tutor.cnic++
    if (plan.photo) counts.tutor.photo++
    if (plan.selfie) counts.tutor.selfie++

    // Stage before (as People showed it) and after the repair.
    const afterRow = { ...p, ...repairPatch(plan, now) }
    const after = tutorCardStatuses(
      tutorDocFactsFromRow(afterRow, {
        hasSelfieFile,
        hasCnicFile,
        hasCnicReview: mine.some((d) => d.kind === 'cnic' && d.status === 'review'),
        hasSelfieReview: mine.some((d) => d.kind === 'selfie' && d.status === 'review'),
      }),
    )
    const before = storedStatuses(after, plan)
    const base = { feePaid: feePaid.has(p.id), completion: p.profile_completion ?? 0 }
    const s0: PipeStage = pipelineStage({ ...pipeDocsOf({ statuses: before, oldestUploadAt: null }), ...base })
    const s1: PipeStage = pipelineStage({ ...pipeDocsOf({ statuses: after, oldestUploadAt: null }), ...base })
    // The Verified badge rule (fee + all three submitted + none rejected) reads
    // the stored CNIC state, so the repair can newly meet it.
    const badge0 = tutorVerifiedBadgeOk(base.feePaid, tutorDocStatusesFromProfile(p, hasSelfieFile))
    const badge1 = tutorVerifiedBadgeOk(base.feePaid, tutorDocStatusesFromProfile(afterRow, hasSelfieFile))
    if (!badge0 && badge1) badgeGain++
    if (s0 !== s1) {
      const k = `${s0} → ${s1}`
      moves.set(k, (moves.get(k) ?? 0) + 1)
      const real = !p.is_seed && !p.is_test_name && !p.hidden_from_public && !p.is_team_account && !p.is_suspended && !p.is_banned
      if (real) movesReal++
    }
  }

  console.log(apply ? 'APPLY — writing.' : 'DRY RUN — nothing is written.')
  console.log(`Tutors to repair: ${counts.tutor.members} (CNIC ${counts.tutor.cnic} · profile photo ${counts.tutor.photo} · selfie ${counts.tutor.selfie})`)
  console.log(`Parents to repair: ${counts.parent.members} (CNIC ${counts.parent.cnic})`)
  console.log('Tutors whose People stage would change:')
  if (moves.size === 0) console.log('  none')
  for (const [k, n] of [...moves.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`)
  console.log(`  of these, real accounts (not seed / test / hidden / team / paused / banned): ${movesReal}`)
  console.log(`Fee-paid tutors who would newly meet the Verified badge rule: ${badgeGain}`)
  console.log('(Stages are computed from the stored profile completion; "waiting" needs all three documents and 80% or more.)')

  if (!apply) return

  let written = 0
  for (const { id, plan } of toWrite) {
    // Each write repeats the rule in its WHERE clause, so a status decided
    // since the read above is never overwritten.
    if (plan.cnic) {
      const { error } = await admin
        .from('profiles')
        .update({ verification_state: 'submitted', verification_submitted_at: now })
        .eq('id', id)
        .is('cnic_verified_at', null)
        .or('verification_state.is.null,verification_state.eq.none')
      if (error) throw new Error(`cnic update failed: ${error.message}`)
    }
    if (plan.photo) {
      const { error } = await admin.from('profiles').update({ profile_pic_status: 'pending' }).eq('id', id).is('profile_pic_status', null)
      if (error) throw new Error(`photo update failed: ${error.message}`)
    }
    if (plan.selfie) {
      const { error } = await admin.from('profiles').update({ selfie_status: 'pending' }).eq('id', id).is('selfie_status', null)
      if (error) throw new Error(`selfie update failed: ${error.message}`)
    }
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: ACTOR,
      actor_role: 'system',
      action: 'document.status_repair',
      target_type: 'member',
      target_id: id,
      detail: {
        items: [plan.cnic && 'CNIC', plan.photo && 'Profile photo', plan.selfie && 'Selfie'].filter(Boolean),
        before: 'Not uploaded (no status)',
        after: 'Waiting for approval',
        reason: 'File on record with no review status; approved and rejected untouched',
      },
    })
    written++
  }
  console.log(`Done: ${written} members updated, one Audit row each.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
