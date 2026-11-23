/**
 * scripts/test-pr18.ts — npm run test:pr18
 *
 * PR-18 (owner, 23 Nov 2026): AI tuition posting with contact checks, the
 * "next, next" WhatsApp follow-up mode, OTP-verified alert emails with "I'm on
 * it", and the ranking refresh moved into the database. Pure rules are run
 * directly with INVENTED posts and numbers (the AI is mocked); wiring is
 * checked in the source. Reads nothing from production.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { hasNumberLeft, redactForAi } from '../lib/postRedactCore'
import { AI_UNAVAILABLE, formatTitle, mapAiAnswer, parseAiJson, runExtraction, type AiLists, type Completer } from '../lib/aiTuitionExtractCore'
import {
  blockFor,
  CONTACT_BLOCKED_MESSAGE,
  DIFFERENT_TICK,
  postDecision,
  postEnabled,
  repeatsFor,
  REPEAT_LINE,
  type RepeatCandidate,
} from '../lib/postingChecksCore'
import { formMayOpen, isBlockedOutcome, numberFirstOutcome, NUMBER_FIRST_DNU } from '../lib/numberFirstCore'
import { daysSince, modeEligible, modeMessage, modeOrder, ONBOARDING_PATH, isStuckEmailSignup, sessionLine, type ModeCandidate } from '../lib/followUpModeCore'
import { alertEmail, alertRoom, alertStopAt, alertTextSafe, budgetWarning, digestDue, digestEmail, parseRecipients } from '../lib/otpAlertsCore'
import { decideAll, NO_FACTS } from '../lib/email/policyCore'
import { kindAllowed, kindOfTemplateKey, KIND_LABEL, pipeTemplateKey } from '../lib/tutorPipelineCore'
import { siteLink } from '../lib/waLinkCore'

const src = (p: string) => readFileSync(p, 'utf8')
let n = 0
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  n++
  console.log(`  ✓ ${name}`)
}

// Invented lists — not the production taxonomy.
const LISTS: AiLists = {
  jobTitles: ['Home Tutor', 'Online Tutor', 'School Teacher', 'Quran Teacher'],
  cities: ['Islamabad', 'Karachi', 'Lahore'],
  tree: {
    School: { 'Grade 5': ['English', 'Mathematics', 'Science'], 'Grade 6': ['English', 'Mathematics', 'Urdu'] },
    'O Level': { 'O Level 1': ['Chemistry', 'Mathematics', 'Physics'] },
    'Holy Quran': { Nazra: [] },
  },
}

// Invented posts with invented numbers in every common shape.
const POST_EN = 'Female home tutor required for Grade 5 and 6 maths and english in DHA Phase 5 Lahore. Mon to Fri evening. Fee 15000. Contact 0300-1234567 or +92 321 7654321. Email parent.x@example.com'
const POST_ROMAN = 'Ghar pe teacher chahiye class 6 ke liye, maths aur urdu, Gulshan Karachi, shaam ko, 923451112223 pe WhatsApp karein. Fees 12000'
const POST_URDU = 'لاہور میں او لیول فزکس کے لیے ٹیوٹر چاہیے۔ رابطہ: 0333 9876543'

async function main() {
  console.log('PR-18 Part A — AI tuition posting')

  await test('phone numbers are taken out locally in every format, emails too', () => {
    const r = redactForAi(POST_EN)
    assert.deepEqual(r.mobiles, ['923001234567', '923217654321'])
    assert.ok(!r.text.includes('1234567') && !r.text.includes('7654321'))
    assert.ok(r.text.includes('[PHONE_1]') && r.text.includes('[PHONE_2]') && r.text.includes('[EMAIL]'))
    assert.equal(hasNumberLeft(r.text), false)
    const roman = redactForAi(POST_ROMAN)
    assert.deepEqual(roman.mobiles, ['923451112223'])
    assert.equal(hasNumberLeft(roman.text), false)
    const urdu = redactForAi(POST_URDU)
    assert.deepEqual(urdu.mobiles, ['923339876543'])
    // A landline and a CNIC-shaped number are taken out too; a fee is kept.
    const other = redactForAi('Call 042-35761234, CNIC 35202-1234567-1, fee 15000-20000')
    assert.ok(!/35761234|1234567/.test(other.text))
    assert.ok(other.text.includes('15000-20000'))
    assert.ok(hasNumberLeft('ring 0300 1234567'))
  })

  await test('the phone number never reaches the AI (mocked), even if the browser sent it', async () => {
    let seen = ''
    const mock: Completer = async (a) => {
      seen = a.system + '\n' + a.prompt
      return { ok: true, text: '{"jobType":"Home Tutor","city":"Lahore","area":"DHA Phase 5","category":"School","levels":["Grade 5","Grade 6"],"subjectsByLevel":{"Grade 5":["maths","eng"],"Grade 6":["Maths","English"]},"gender":"female","days":["weekdays"],"times":["evening"],"feeMin":15000,"feeMax":null,"school":null,"description":"A parent needs a female tutor.","unsure":[]}' }
    }
    // The RAW post (as if the browser had not redacted it): the pipeline redacts again.
    const r = await runExtraction(POST_EN, LISTS, mock)
    assert.ok(r.ok)
    for (const digits of ['1234567', '7654321', '03001234567', '923001234567', 'parent.x@example.com']) assert.ok(!seen.includes(digits), `the AI saw ${digits}`)
    if (!r.ok) return
    const f = r.fill
    assert.equal(f.teachingMode, 'Home Tutor')
    assert.equal(f.city, 'Lahore')
    assert.deepEqual(f.levels, ['Grade 5', 'Grade 6'])
    assert.deepEqual(f.gradeSubjects, { 'Grade 5': ['Mathematics', 'English'], 'Grade 6': ['Mathematics', 'English'] })
    assert.equal(f.genderPreference, 'female')
    assert.equal(f.scheduleSlots.length, 5)
    assert.ok(f.scheduleSlots.every((s) => s.slot === 'evening'))
    assert.equal(f.budgetMin, '15000')
    assert.equal(f.budgetMax, '15000')
    assert.equal(f.feeExact, true)
    assert.equal(f.title.split(' | ')[0], 'Home Tutor')
    assert.equal(f.title.split(' | ').at(-1), 'Lahore')
    assert.deepEqual(f.uncertain, ['school'].filter(() => false)) // nothing unsure, no school (area stands in)
  })

  await test('anything off our lists, or unsure, is highlighted for staff', () => {
    const f = mapAiAnswer(
      { jobType: 'Tuition wala', mode: 'online', city: 'Multan', area: '', category: null, levels: ['Grade 6'], subjectsByLevel: { 'Grade 6': ['Maths', 'Astrology'] }, gender: null, days: ['someday'], times: [], feeMin: null, unsure: ['gender'] },
      LISTS,
    )
    assert.equal(f.teachingMode, 'Online Tutor') // home/online picks the title
    assert.equal(f.city, '')
    assert.equal(f.category, 'School') // the grade found its category
    assert.deepEqual(f.gradeSubjects['Grade 6'], ['Mathematics'])
    for (const k of ['city', 'area', 'subjects', 'genderPreference', 'schedule', 'budget', 'title'] as const) assert.ok(f.uncertain.includes(k), k)
    assert.ok(!f.uncertain.includes('teachingMode'))
  })

  await test('title format "Post type | Class | School name | City"; area when no school', () => {
    assert.equal(formatTitle({ jobType: 'School Teacher', levels: ['Grade 5'], school: 'Example School', area: 'Gulberg', city: 'Lahore' }), 'School Teacher | Grade 5 | Example School | Lahore')
    assert.equal(formatTitle({ jobType: 'Home Tutor', levels: ['Grade 5'], school: '', area: 'Gulberg', city: 'Lahore' }), 'Home Tutor | Grade 5 | Gulberg | Lahore')
  })

  await test('AI unavailable or a broken answer → a plain error; the manual form still works', async () => {
    const down: Completer = async () => ({ ok: false, reason: 'timed out' })
    const r = await runExtraction(POST_ROMAN, LISTS, down)
    assert.deepEqual(r, { ok: false, status: 503, error: AI_UNAVAILABLE })
    const junk: Completer = async () => ({ ok: true, text: 'sorry' })
    assert.equal((await runExtraction(POST_ROMAN, LISTS, junk)).ok, false)
    assert.equal(parseAiJson('```json\n{"city":"Lahore"}\n```')?.city, 'Lahore')
    const form = src('components/forms/PostTuitionForm.tsx')
    assert.ok(form.includes('pasteBox') && form.includes('aiPaste'), 'the paste box sits on top of the same form')
  })

  await test('the browser redacts BEFORE the AI request; the route caps calls and never logs the post', () => {
    const box = src('components/forms/PastePostBox.tsx')
    const redactAt = box.indexOf('redactForAi(text)')
    const fetchAt = box.indexOf("fetch('/api/admin/jobs/ai-extract'")
    assert.ok(redactAt > 0 && fetchAt > redactAt)
    assert.ok(box.includes('JSON.stringify({ text: red.text })'))
    const route = src('app/api/admin/jobs/ai-extract/route.ts')
    assert.ok(route.includes("rateLimit('tuition_ai_fill', gate.actor.id)"))
    assert.ok(!/console\.(log|warn|error)/.test(route))
    assert.ok(src('lib/rateLimit.ts').includes('tuition_ai_fill: { windowSeconds: 86_400, max: 200 }'))
    const server = src('lib/aiTuitionExtract.ts')
    assert.ok(!/console\.\w+\([^)]*post/.test(server))
  })

  await test('contact checks: withdrawn → erased → on hold; one wording for withdrawn and erased', () => {
    assert.equal(blockFor({ withdrawn: true, erased: true, onHold: true })?.kind, 'withdrawn')
    assert.equal(blockFor({ withdrawn: false, erased: true, onHold: true })?.kind, 'erased')
    assert.equal(blockFor({ withdrawn: false, erased: false, onHold: true })?.kind, 'on_hold')
    assert.equal(blockFor({ withdrawn: false, erased: false, onHold: false }), null)
    assert.equal(CONTACT_BLOCKED_MESSAGE, "This parent asked not to be contacted. It can't be posted.")
    assert.equal(NUMBER_FIRST_DNU, CONTACT_BLOCKED_MESSAGE)
    const erased = numberFirstOutcome({ msisdn: '923001234567', doNotUse: false, onHold: false, erased: true, tuitions: [], parent: null })
    assert.equal(erased.kind, 'erased')
    assert.ok(isBlockedOutcome(erased) && !formMayOpen(erased, true))
  })

  await test('repeats: same number, overlapping grade OR subject, open/paused, last 30 days', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    const row = (id: string, o: Partial<RepeatCandidate>): RepeatCandidate => ({ id, ref: id, title: id, status: 'open', postedAt: '2026-11-20T00:00:00Z', href: `/admin/jobs/${id}`, levels: [], masterIds: [], ...o })
    const hits = repeatsFor(
      { levels: ['Grade 5'], masterIds: [10, 11] },
      [
        row('grade', { levels: ['grade 5'] }),
        row('subject', { levels: ['Grade 9'], masterIds: [11] }),
        row('none', { levels: ['Grade 9'], masterIds: [99] }),
        row('old', { levels: ['Grade 5'], postedAt: '2026-10-01T00:00:00Z' }),
        row('closed', { levels: ['Grade 5'], status: 'closed' }),
        row('paused', { levels: ['Grade 5'], status: 'paused', postedAt: '2026-11-22T00:00:00Z' }),
        row('self', { levels: ['Grade 5'] }),
      ],
      now,
      'self',
    )
    assert.deepEqual(hits.map((h) => h.id), ['paused', 'grade', 'subject'])
    assert.equal(REPEAT_LINE, 'This looks like a tuition already posted:')
    assert.equal(DIFFERENT_TICK, 'This is a different tuition')
  })

  await test('server decision: a block needs the Owner + a reason; a repeat needs the tick', () => {
    const block = { kind: 'withdrawn' as const, message: CONTACT_BLOCKED_MESSAGE }
    const rep = [{ id: 'j', ref: 'TM-1', title: 't', status: 'open', postedAt: '2026-11-20', href: '/admin/jobs/j' }]
    assert.equal(postDecision({ result: { block, repeats: [] }, isOwner: false, overrideReason: null, confirmedDifferent: false }).ok, false)
    const notOwner = postDecision({ result: { block, repeats: [] }, isOwner: false, overrideReason: 'she agreed again', confirmedDifferent: false })
    assert.ok(!notOwner.ok && notOwner.status === 403 && notOwner.code === 'owner_only')
    const short = postDecision({ result: { block, repeats: [] }, isOwner: true, overrideReason: 'ok', confirmedDifferent: false })
    assert.ok(!short.ok && short.code === 'override_reason')
    const owner = postDecision({ result: { block, repeats: [] }, isOwner: true, overrideReason: 'Parent called back and asked', confirmedDifferent: false })
    assert.ok(owner.ok && owner.override === 'withdrawn')
    const r1 = postDecision({ result: { block: null, repeats: rep }, isOwner: false, overrideReason: null, confirmedDifferent: false })
    assert.ok(!r1.ok && r1.status === 409 && r1.code === 'repeat')
    assert.ok(postDecision({ result: { block: null, repeats: rep }, isOwner: false, overrideReason: null, confirmedDifferent: true }).ok)
    // The Post button in the form follows the same rule.
    assert.equal(postEnabled({ result: { block, repeats: [], ownerMayOverride: false }, checking: false, overrideReason: 'x'.repeat(20), confirmedDifferent: false }), false)
    assert.equal(postEnabled({ result: { block, repeats: [], ownerMayOverride: true }, checking: false, overrideReason: 'x'.repeat(20), confirmedDifferent: false }), true)
    assert.equal(postEnabled({ result: { block: null, repeats: rep, ownerMayOverride: false }, checking: false, overrideReason: '', confirmedDifferent: false }), false)
    assert.equal(postEnabled({ result: { block: null, repeats: rep, ownerMayOverride: false }, checking: true, overrideReason: '', confirmedDifferent: true }), false)
  })

  await test('enforced on the server for both forms (create + edit), Owner override logged, parent post too', () => {
    const jobs = src('lib/jobs.ts')
    const team = jobs.slice(jobs.indexOf('export async function createTeamJob'), jobs.indexOf('export async function updateTeamJob'))
    assert.ok(team.indexOf('staffContactDecision(input, number.msisdn, actor, null)') > 0)
    assert.ok(team.indexOf('staffContactDecision') < team.indexOf(".from('jobs')\n    .insert"), 'checked before the insert')
    assert.ok(team.includes("auditOwnerOverride(actor, { jobId: job.id as string, kind: checks.override"))
    assert.ok(team.includes("recordPostSource(job.id as string, input.filledByAi ? 'ai' : 'manual', actor.id)"))
    const upd = jobs.slice(jobs.indexOf('export async function updateTeamJob'))
    assert.ok(upd.includes('staffContactDecision(input, number.msisdn, actor, jobId)'))
    assert.ok(upd.includes("where: 'edit'"))
    assert.ok(jobs.includes('postingBlock(tuitionNumbers({ title: input.title, description: input.description }))'), 'parent posts refuse an erased number in the text')
    const checks = src('lib/postingChecks.ts')
    assert.ok(checks.includes("action: 'job.contact_check_override'"))
    assert.ok(checks.includes("from('erased_fingerprints')") && !checks.includes('signup_block_attempts'), 'posting reads the erased list but records no sign-up attempt')
    const create = src('app/api/admin/jobs/create/route.ts')
    for (const k of ['confirmedDifferent', 'ownerOverrideReason', 'filledByAi']) assert.ok(create.includes(k), k)
    assert.ok(src('app/api/admin/jobs/[id]/route.ts').includes('ownerOverrideReason'))
    assert.ok(src('app/api/admin/jobs/number-check/route.ts').includes("ownerMayOverride: blocked && gate.actor.adminRole === 'owner'"))
    assert.ok(src('lib/numberFirst.ts').includes('postingBlock([msisdn])'))
    // The manual form and the AI-filled form are ONE form posting to ONE route.
    const admin = src('app/admin/jobs/new/AdminJobForm.tsx')
    assert.ok(admin.includes('aiPaste') && admin.includes("'/api/admin/jobs/create'"))
    assert.ok(src('components/forms/PostTuitionForm.tsx').includes('disabled={busy || !postReady || !contactReady}'))
  })

  console.log('PR-18 Part B — follow-up mode')

  await test('queue order: stuck email sign-ups first (Documents missing), then last 14 days newest first, then busiest cities', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    const c = (id: string, createdAt: string, city: string, stuck = false): ModeCandidate => ({ id, createdAt, city, stuck })
    const cands = [
      c('old-quiet', '2026-09-01T00:00:00Z', 'Multan'),
      c('old-busy', '2026-08-01T00:00:00Z', 'Lahore'),
      c('recent-1', '2026-11-20T00:00:00Z', 'Multan'),
      c('recent-2', '2026-11-22T00:00:00Z', 'Multan'),
      c('stuck', '2026-11-01T00:00:00Z', 'Multan', true),
    ]
    const open = new Map([['lahore', 40], ['multan', 3]])
    assert.deepEqual(modeOrder(cands, open, 'missing', now).map((x) => x.id), ['stuck', 'recent-2', 'recent-1', 'old-busy', 'old-quiet'])
    // Outside Documents missing the stuck group has no front place.
    assert.deepEqual(modeOrder(cands, open, 'approved', now).map((x) => x.id), ['recent-2', 'recent-1', 'old-busy', 'stuck', 'old-quiet'])
  })

  await test('only tutors due now, with a number; stuck = real email, no verified mobile, before PR-17', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    const base = { stage: 'missing' as const, section: 'not' as const, notInterested: false, paused: false }
    assert.ok(modeEligible(base, { stage: 'missing', hasNumber: true, nowMs: now }))
    assert.ok(!modeEligible({ ...base, section: 'done' }, { stage: 'missing', hasNumber: true, nowMs: now }))
    assert.ok(!modeEligible({ ...base, notInterested: true }, { stage: 'missing', hasNumber: true, nowMs: now }))
    assert.ok(!modeEligible({ ...base, paused: true }, { stage: 'missing', hasNumber: true, nowMs: now }))
    assert.ok(!modeEligible({ ...base, retryAt: '2026-11-24T00:00:00Z' }, { stage: 'missing', hasNumber: true, nowMs: now }), 'No answer retries tomorrow')
    assert.ok(!modeEligible(base, { stage: 'missing', hasNumber: false, nowMs: now }))
    assert.ok(!modeEligible(base, { stage: 'approved', hasNumber: true, nowMs: now }))
    assert.ok(isStuckEmailSignup({ email: 'a@example.com', synthetic: false, phoneVerifiedAt: null, createdAt: '2026-11-10T00:00:00Z' }))
    assert.ok(!isStuckEmailSignup({ email: 'a@example.com', synthetic: false, phoneVerifiedAt: null, createdAt: '2026-11-24T00:00:00Z' }))
    assert.ok(!isStuckEmailSignup({ email: '923001234567@users.tutormint.org', synthetic: true, phoneVerifiedAt: null, createdAt: '2026-11-10T00:00:00Z' }))
  })

  await test('message link opens onboarding at the first unfinished step; session count; days since sign-up', () => {
    const docs = siteLink('/tutor/dashboard/settings')
    const msg = `Assalam o Alaikum Ali, please upload: CNIC.\n\n${docs}\n\nNeed help? WhatsApp 0321 5872222`
    assert.ok(modeMessage('missing', msg, docs, siteLink(ONBOARDING_PATH)).includes(siteLink('/tutor/onboarding')))
    assert.equal(modeMessage('approved', msg, docs, siteLink(ONBOARDING_PATH)), msg)
    assert.equal(sessionLine(12), '12 done this session')
    assert.equal(daysSince('2026-11-23T10:00:00Z', Date.parse('2026-11-23T12:00:00Z')), 'today')
    assert.equal(daysSince('2026-11-20T10:00:00Z', Date.parse('2026-11-23T12:00:00Z')), '3 days')
  })

  await test('claims, recording and the server-built WhatsApp link (wiring)', () => {
    const mode = src('lib/followUpMode.ts')
    assert.ok(mode.includes('claimNextSession(actor.id, order, stage)'))
    const open = mode.slice(mode.indexOf('export async function openWhatsApp'), mode.indexOf('export async function recordOutcome'))
    assert.ok(open.indexOf("action: 'member.contact_reveal'") < open.indexOf('waSendHref('), 'the reveal is logged before the link is built')
    assert.ok(open.includes("via: 'follow_up_mode'"))
    const rec = mode.slice(mode.indexOf('export async function recordOutcome'))
    assert.ok(rec.includes("recordPipelineFollowUp({ memberId: a.memberId, kind: 'whatsapp'"))
    assert.ok(rec.includes("recordCallAttempt(a.memberId, 'no_answer', actor)"), 'No answer is an attempt only')
    assert.ok(rec.includes("releaseSession(actor.id, a.memberId, 'skip')"))
    const claims = src('lib/memberClaims.ts')
    assert.ok(claims.includes("rpc('claim_follow_up_session'") && claims.includes('p_ttl_seconds: CLAIM_TTL_SECONDS'))
    const mig = src('supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql')
    assert.ok(mig.includes("member_work_claims_one_session") && mig.includes("where kind = 'session' and released_at is null"))
    assert.ok(mig.includes("w.kind = 'on_it' and w.released_at is null and w.staff_id <> p_staff"))
    const client = src('app/admin/users/follow-up-mode/FollowUpModeClient.tsx')
    assert.ok(!client.includes('sessionStorage') && !client.includes('localStorage'))
    assert.ok(!client.includes('wa.me') && !client.includes('api.whatsapp.com'))
    assert.ok(src('app/admin/users/PeopleTabs.tsx').includes('Start follow-ups'))
  })

  console.log('PR-18 Part C — OTP alerts and "I\'m on it"')

  await test('alert email: subject, body, Open in admin — nothing personal beyond name and city', () => {
    const m = { id: '11111111-2222-3333-4444-555555555555', name: 'Ayesha K', role: 'tutor' as const, city: 'Lahore', signedUpAt: '2026-11-23T05:00:00Z', steps: { done: 7, total: 16 } }
    const e = alertEmail(m)
    assert.equal(e.subject, 'New verified tutor: Ayesha K, Lahore')
    assert.ok(e.text.includes('Steps done: 7 of 16') && e.text.includes('Role: Tutor') && e.text.includes('City: Lahore'))
    assert.ok(e.html.includes('Open in admin') && e.html.includes('/admin/users/11111111-2222-3333-4444-555555555555'))
    assert.ok(alertTextSafe(e.text) && alertTextSafe(e.html))
    const p = alertEmail({ ...m, role: 'parent', steps: null })
    assert.equal(p.subject, 'New verified parent: Ayesha K, Lahore')
    assert.ok(!p.text.includes('Steps done'))
    assert.ok(alertTextSafe(digestEmail([m, { ...m, role: 'parent', steps: null }]).text))
    assert.equal(alertTextSafe('call 0300 1234567'), false)
    assert.equal(alertTextSafe('a@b.com'), false)
    assert.equal(alertTextSafe('Rs 199'), false)
  })

  await test('recipients and the daily-limit guard (alerts stop at 80 of 100)', () => {
    assert.deepEqual(parseRecipients('["11111111-2222-3333-4444-555555555555","bad"]'), ['11111111-2222-3333-4444-555555555555'])
    assert.equal(alertStopAt(100), 80)
    assert.ok(alertRoom(78, 2, 100))
    assert.ok(!alertRoom(79, 2, 100))
    assert.ok(!alertRoom(80, 1, 100))
    assert.ok(!alertRoom(0, 0, 100))
    assert.equal(budgetWarning({ otherPerDay: 25, verifiedPerDay: 15, recipients: 2, digest: false, dailyLimit: 100 }), null)
    assert.ok(budgetWarning({ otherPerDay: 30, verifiedPerDay: 16, recipients: 4, digest: false, dailyLimit: 100 })?.includes('more than 80'))
    assert.ok(digestDue(null, Date.now()))
    assert.ok(!digestDue(new Date(Date.now() - 5 * 60_000).toISOString(), Date.now()))
    // The email policy: alerts are never de-duplicated or held for tomorrow — over the line they are skipped.
    const facts = { ...NO_FACTS, recent: new Set(['otp_alert|owner@example.com']), sentToday: 10, limit: 100 }
    assert.deepEqual(decideAll([{ to: 'owner@example.com', template: 'otp_alert' }], facts), [{ action: 'send' }])
    const full = decideAll([{ to: 'owner@example.com', template: 'otp_alert' }], { ...facts, sentToday: 95 })
    assert.equal(full[0].action, 'skip')
    // Receipts and member emails are untouched by the alert rule.
    assert.equal(decideAll([{ to: 'm@example.com', template: 'bank_transfer_pending' }], { ...facts, sentToday: 95 })[0].action, 'send')
  })

  await test('alerts are wired to both verify paths (first verification only), the cron and the Owner-only setting', () => {
    const otp = src('app/api/auth/otp/route.ts')
    assert.ok(otp.includes('if (!wasVerified) await queueOtpAlert(user.id)'))
    assert.ok(src('lib/pendingSignup.ts').includes('await queueOtpAlert(userId)'))
    assert.ok(src('app/api/cron/admin-summary/route.ts').includes('runOtpAlerts()'))
    const lib = src('lib/otpAlerts.ts')
    assert.ok(lib.includes("bellOwnerOnce(admin)") && lib.includes("'held_limit'"))
    assert.ok(lib.includes('is_test_name') && lib.includes('is_team_account'))
    const route = src('app/api/admin/settings/otp-alerts/route.ts')
    assert.ok(route.includes("gate.actor.adminRole !== 'owner'"))
    const mig = src('supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql')
    assert.ok(mig.includes("'alerts.otp_recipients'") && mig.includes("admin_role = 'owner'") && mig.includes("'staff.insights'"), 'default: the Owner + Mohsin (the Insights grant)')
    assert.ok(mig.includes("('alerts.otp_digest', 'off')"))
  })

  await test('"I\'m on it": first tap wins, counts as the stage follow-up, Owner reassigns', () => {
    assert.equal(KIND_LABEL.claim, "I'm on it")
    assert.ok(kindAllowed('voice', 'claim'))
    assert.equal(kindOfTemplateKey(pipeTemplateKey('missing', 'claim')), 'claim')
    const claims = src('lib/memberClaims.ts')
    assert.ok(claims.includes("recordPipelineFollowUp({ memberId, kind: 'claim', actor, strict: false })"))
    assert.ok(claims.includes('is on it.'))
    const reassign = claims.slice(claims.indexOf('export async function reassignOnIt'))
    assert.ok(reassign.indexOf("actor.adminRole !== 'owner'") < reassign.indexOf('.insert('))
    assert.ok(src('lib/tutorPipeline.ts').includes("r.channel === 'claim' ? 'claim'"))
    assert.ok(src('supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql').includes("channel in ('whatsapp', 'call', 'email', 'claim')"))
    assert.ok(src('app/admin/users/[id]/page.tsx').includes('<OnItButton'))
    assert.ok(src('app/admin/users/follow-up-mode/FollowUpModeClient.tsx').includes('<OnItButton'))
  })

  console.log('PR-18 Part D — ranking refresh')

  await test('the refresh runs in pg_cron; Vercel only steps in when it is stale; listing still gated live', () => {
    const mig = src('supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql')
    assert.ok(mig.includes("cron.schedule('tm-rank-cache-refresh', '* * * * *', 'select public.refresh_tutor_rank_cache(null)')"))
    const cron = src('app/api/cron/admin-summary/route.ts')
    assert.ok(cron.includes('refreshRankCacheIfStale()') && !/refreshRankCache\(\)/.test(cron))
    assert.ok(src('lib/rankCache.ts').includes("return 'db'"))
    assert.ok(src('supabase/migrations/243_pr17_rank_cache.sql').includes('the LISTING itself is still checked live against'))
  })

  console.log(`\n✓ ${n} PR-18 checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
