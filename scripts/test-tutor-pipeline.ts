/**
 * scripts/test-tutor-pipeline.ts  —  npm run test:pipeline
 *
 * Owner, 8 Nov 2026: People and Follow-ups merged into one tutor pipeline.
 * Invented data only — no database, no real names or numbers.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  FOLLOW_STAGES,
  PIPE_STAGES,
  contactsInStage,
  followState,
  followUpsToPeople,
  kindAllowed,
  legacyPeopleTutorHref,
  pipeMessage,
  pipelineOrder,
  pipelineStage,
  pipeProgress,
  pipeTemplateKey,
  stageOfProgress,
  kindOfTemplateKey,
  type DocState,
  type PipeContact,
} from '../lib/tutorPipelineCore'
import { followUpDue, pipeCardFrom, pipeTags, withContacts, type PipeDocFacts } from '../lib/tutorPipelineCardCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'
import { peopleFixed } from '../lib/peopleDirectoryCore'
import { roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { isMoneyItem } from '../lib/overviewMoneyCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS, RETIRED_OVERVIEW_KEYS } from '../lib/overviewItemsCore'
import { navBadgesFrom } from '../lib/adminSummaryCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-01T06:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const STATES: DocState[] = ['approved', 'waiting', 'rejected', 'none']

/** A card status from a pipeline state (invented). */
function cs(s: DocState, reason: string | null = null): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason: null, hasUpload: true }
  if (s === 'rejected') return { status: 'rejected', reason, hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
function docs(cnic: DocState, photo: DocState, selfie: DocState): PipeDocFacts {
  return { statuses: { cnic: cs(cnic, 'Blurry'), profilePic: cs(photo, 'Face not clear'), selfie: cs(selfie, 'Not a live photo') }, oldestUploadAt: null }
}
function card(a: { cnic?: DocState; photo?: DocState; selfie?: DocState; feePaid?: boolean; contacts?: PipeContact[]; ni?: boolean; now?: number }) {
  return pipeCardFrom({
    name: 'Sana Test-Invented',
    feePaid: a.feePaid ?? false,
    docs: docs(a.cnic ?? 'approved', a.photo ?? 'approved', a.selfie ?? 'approved'),
    contacts: a.contacts ?? [],
    notInterested: a.ni ?? false,
    paused: false,
    lastActiveAt: iso(T0),
    support: '0300 0000000',
    nowMs: a.now ?? T0,
  })
}
const contact = (at: number, kind: PipeContact['kind'], stage: PipeContact['stage']): PipeContact => ({ at: iso(at), kind, stage, docsApproved: null, staffName: 'Staff A' })

// ------------------------------------------------------------- stages ---

test('every tutor lands in exactly one stage, with the right precedence', () => {
  const seen: Record<string, number> = {}
  for (const feePaid of [false, true])
    for (const cnic of STATES)
      for (const photo of STATES)
        for (const selfie of STATES) {
          const s = pipelineStage({ cnic, photo, selfie, feePaid })
          assert.ok((PIPE_STAGES as readonly string[]).includes(s))
          seen[s] = (seen[s] ?? 0) + 1
          const all = [cnic, photo, selfie]
          // Precedence: Paid → Rejected → Waiting → Missing → Approved.
          if (feePaid) assert.equal(s, 'paid')
          else if (all.includes('rejected')) assert.equal(s, 'rejected')
          else if (all.includes('waiting')) assert.equal(s, 'waiting')
          else if (all.includes('none')) assert.equal(s, 'missing')
          else assert.equal(s, 'approved')
        }
  // 2 × 4³ combinations, each counted once.
  assert.equal(Object.values(seen).reduce((a, b) => a + b, 0), 128)
  for (const s of PIPE_STAGES) assert.ok(seen[s] > 0, s)
  // Rejected with a re-upload is Waiting (the card shows the new upload pending).
  assert.equal(pipelineStage({ cnic: 'waiting', photo: 'approved', selfie: 'none', feePaid: false }), 'waiting')
  // The card says what is missing / rejected.
  const m = card({ cnic: 'none', selfie: 'none' })
  assert.deepEqual(m.missing, ['CNIC', 'Selfie'])
  const r = card({ photo: 'rejected' })
  assert.deepEqual(r.rejected, [{ name: 'Profile photo', reason: 'Face not clear' }])
})

test('the list order: stage, Not followed up first, paused last, newest active first', () => {
  const rows = [
    { id: 'a', stage: 'approved' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0) },
    { id: 'b', stage: 'missing' as const, section: 'done' as const, paused: false, lastActiveAt: iso(T0) },
    { id: 'c', stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0 - DAY) },
    { id: 'd', stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0) },
    { id: 'e', stage: 'missing' as const, section: 'not' as const, paused: true, lastActiveAt: iso(T0 + DAY) },
    { id: 'f', stage: 'paid' as const, section: null, paused: false, lastActiveAt: iso(T0) },
  ]
  assert.deepEqual(pipelineOrder(rows).map((r) => r.id), ['d', 'c', 'e', 'b', 'a', 'f'])
})

// ------------------------------------------------------------ follow-ups ---

test('logging a follow-up moves the tutor to Followed up; they return when due (2 days, then every 3)', () => {
  // Never contacted: Not followed up, Follow-up 1 is a WhatsApp message.
  let c = card({ cnic: 'none' })
  assert.equal(c.stage, 'missing')
  assert.equal(c.section, 'not')
  assert.equal(c.follow?.nextNumber, 1)
  assert.equal(c.follow?.nextKind, 'whatsapp')
  assert.ok(followUpDue(c))

  // Follow-up 1 logged now → Followed up, next due in 2 days.
  const cs1 = [contact(T0, 'whatsapp', 'missing')]
  c = withContacts(c, cs1, T0 + 60_000)
  assert.equal(c.section, 'done')
  assert.equal(c.follow?.dueAt, iso(T0 + 2 * DAY))
  assert.equal(pipeTags(c).fu, 'done')
  assert.ok(!followUpDue(c))
  // 1 day 23 hours later: still Followed up. At 2 days: back to Not followed up, Follow-up 2 is a voice note.
  assert.equal(followState('missing', cs1, T0 + 2 * DAY - 3_600_000).section, 'done')
  const at2 = followState('missing', cs1, T0 + 2 * DAY)
  assert.equal(at2.section, 'not')
  assert.equal(at2.nextNumber, 2)
  assert.equal(at2.nextKind, 'voice')

  // Follow-up 2 (voice note) → next due 3 days later, then WhatsApp or call.
  const cs2 = [...cs1, contact(T0 + 2 * DAY, 'voice', 'missing')]
  const s2 = followState('missing', cs2, T0 + 2 * DAY + 1)
  assert.equal(s2.section, 'done')
  assert.equal(s2.dueAt, iso(T0 + 5 * DAY))
  const s3 = followState('missing', cs2, T0 + 5 * DAY)
  assert.equal(s3.section, 'not')
  assert.equal(s3.nextKind, 'either')
  // Follow-up 3 by call → every 3 days after.
  const cs3 = [...cs2, contact(T0 + 5 * DAY, 'call', 'missing')]
  assert.equal(followState('missing', cs3, T0 + 5 * DAY + 1).dueAt, iso(T0 + 8 * DAY))
  assert.equal(followState('missing', cs3, T0 + 8 * DAY).section, 'not')

  // The right kind for each number.
  assert.ok(kindAllowed('whatsapp', 'whatsapp') && !kindAllowed('whatsapp', 'call') && !kindAllowed('whatsapp', 'voice'))
  assert.ok(kindAllowed('voice', 'voice') && !kindAllowed('voice', 'whatsapp'))
  assert.ok(kindAllowed('either', 'whatsapp') && kindAllowed('either', 'call') && !kindAllowed('either', 'voice'))
  // What a logged follow-up stores, and how it is read back.
  for (const st of FOLLOW_STAGES) {
    assert.equal(stageOfProgress(pipeProgress(st)), st)
    for (const k of ['whatsapp', 'voice', 'call'] as const) assert.equal(kindOfTemplateKey(pipeTemplateKey(st, k)), k)
  }
})

test('paying or Not interested stops the sequence', () => {
  const contacts = [contact(T0 - 10 * DAY, 'whatsapp', 'approved')]
  // Approved, fee pending: due again.
  const before = card({ contacts, now: T0 })
  assert.equal(before.stage, 'approved')
  assert.ok(followUpDue(before))
  // Paid: no follow-up at all.
  const paid = card({ contacts, feePaid: true, now: T0 })
  assert.equal(paid.stage, 'paid')
  assert.equal(paid.follow, null)
  assert.equal(paid.section, null)
  assert.ok(!followUpDue(paid))
  assert.equal(paid.message, null)
  // Not interested: off the due lists (and the badge), stored as ni.
  const ni = card({ contacts, ni: true, now: T0 })
  assert.ok(!followUpDue(ni))
  assert.equal(pipeTags(ni).ni, true)
  // Waiting for approval is a staff action, never a follow-up.
  const w = card({ selfie: 'waiting' })
  assert.equal(w.stage, 'waiting')
  assert.ok(!followUpDue(w))
  // The badge counts follow-ups due plus documents waiting.
  const b = { reports: 0, receipts: 0, peopleWaiting: 3, pipelineDue: 5, parentOverdue: 2, appsOverdue: { total: 0, byOwner: {} }, paidRed: { total: 0, byOwner: {} } }
  assert.equal(navBadgesFrom(b, { id: 'o', adminRole: 'owner' }, { followUps: true, paidTutors: true, parentFollowUps: true, users: true })['/admin/users'], 10)
  assert.equal(navBadgesFrom(b, { id: 't', adminRole: 'tuitions_staff' }, { followUps: true, paidTutors: false, parentFollowUps: false, users: false })['/admin/users'], 5)
  assert.equal(navBadgesFrom(b, { id: 'o', adminRole: 'owner' }, { followUps: true, paidTutors: true, parentFollowUps: true })['/admin/follow-ups'], undefined)
})

test('a stage change restarts at Follow-up 1', () => {
  // Three follow-ups while documents were missing…
  const old = [contact(T0 - 9 * DAY, 'whatsapp', 'missing'), contact(T0 - 7 * DAY, 'voice', 'missing'), contact(T0 - 4 * DAY, 'call', 'missing')]
  assert.equal(followState('missing', old, T0).sent, 3)
  // …now all approved: the approved stage starts at 1, due now.
  const now = followState('approved', old, T0)
  assert.equal(now.sent, 0)
  assert.equal(now.nextNumber, 1)
  assert.equal(now.nextKind, 'whatsapp')
  assert.equal(now.section, 'not')
  // A follow-up in the new stage counts there and ends the old run.
  const more = [...old, contact(T0, 'whatsapp', 'approved')]
  assert.equal(contactsInStage(more, 'approved').length, 1)
  assert.equal(contactsInStage(more, 'missing').length, 0)
  // Older contacts (before this change) count towards the current stage, so
  // nobody already contacted shows as never contacted — but not past a newer
  // stage's contact, and an older snapshot that says the documents were all
  // approved only counts for "Approved, fee pending".
  const legacy: PipeContact[] = [{ at: iso(T0 - DAY), kind: 'call', stage: null, docsApproved: null, staffName: 'Staff B' }]
  assert.equal(followState('approved', legacy, T0).sent, 1)
  assert.equal(followState('missing', legacy, T0).sent, 1)
  const snap: PipeContact[] = [{ at: iso(T0 - DAY), kind: 'whatsapp', stage: null, docsApproved: true, staffName: null }]
  assert.equal(followState('approved', snap, T0).sent, 1)
  assert.equal(followState('missing', snap, T0).sent, 0)
})

test('a Rejected WhatsApp sets Informed: yes; the message has the reason and how to re-upload', () => {
  const c = card({ cnic: 'rejected' })
  assert.equal(c.stage, 'rejected')
  assert.equal(c.informed, false)
  assert.equal(pipeTags(c).informed, false)
  // A call alone does not inform.
  assert.equal(withContacts(c, [contact(T0, 'call', 'rejected')], T0 + 1).informed, false)
  const done = withContacts(c, [contact(T0, 'whatsapp', 'rejected')], T0 + 1)
  assert.equal(done.informed, true)
  assert.equal(pipeTags(done).informed, true)
  assert.match(c.message ?? '', /CNIC: Blurry/)
  assert.match(c.message ?? '', /upload/i)
})

test('stage messages: plain English, a TutorMint link, no price, no superlative', () => {
  for (const st of FOLLOW_STAGES) {
    const text = pipeMessage(st, { firstName: 'Sana', missing: ['Selfie'], rejected: [{ name: 'CNIC', reason: 'Blurry' }], supportWhatsapp: '0300 0000000' })
    assert.match(text, /^Assalam o Alaikum Sana,/)
    assert.match(text, /https:\/\/www\.tutormint\.org\//)
    assert.ok(!/\bRs\b|PKR|rupee|199|best|largest|No\.?\s?1|leading/i.test(text), text)
  }
  assert.match(pipeMessage('approved', { firstName: 'S', missing: [], rejected: [], supportWhatsapp: null }), /\/pay\/choose\?plan=verified/)
  // WhatsApp links are built by lib/waLinkCore only.
  const people = read('app/admin/users/PeopleTabs.tsx')
  assert.match(people, /waSendHref\(msisdn, pipe\.message, refCode\)/)
  assert.ok(!/wa\.me\//.test(people + read('components/admin/PipelineActions.tsx')))
})

// ------------------------------------------------------------- addresses ---

test('old Follow-ups addresses redirect to the matching People view', () => {
  assert.equal(followUpsToPeople({}), '/admin/users?tab=tutors')
  assert.equal(followUpsToPeople({ closest: 'ready' }), '/admin/users?tab=tutors&stage=approved')
  assert.equal(followUpsToPeople({ closest: 'all_uploaded' }), '/admin/users?tab=tutors&stage=waiting')
  assert.equal(followUpsToPeople({ closest: 'main_uploaded' }), '/admin/users?tab=tutors&stage=missing')
  assert.equal(followUpsToPeople({ chip: 'not_contacted' }), '/admin/users?tab=tutors&fu=not')
  assert.equal(followUpsToPeople({ chip: 'contacted', q: ' Sana ' }), '/admin/users?tab=tutors&fu=done&q=Sana')
  assert.equal(followUpsToPeople({ filter: 'today' }), '/admin/users?tab=tutors&signed=today')
  assert.equal(followUpsToPeople({ tab: 'parents', chip: 'posted', fu: 'sent' }), '/admin/users?tab=parent_followups&chip=posted&fu=sent')
  assert.equal(followUpsToPeople({ tab: 'orphans' }), '/admin/users?tab=orphans')
  // The page itself: a permanent redirect for everyone; Applications still goes to Tuitions → Applications.
  const page = read('app/admin/follow-ups/page.tsx')
  assert.match(page, /permanentRedirect\(followUpsToPeople\(sp\)\)/)
  assert.match(page, /legacyApplicationsHref/)
  // The sidebar has no Follow-ups item; People carries the badge.
  const nav = read('lib/adminNav.ts')
  assert.ok(!/href: '\/admin\/follow-ups'/.test(nav))
  assert.match(nav, /href: '\/admin\/users', label: 'People', icon: 'contact', screen: 'people'/)
  // Old People chips (?docs=, ?paid=) open the matching stage.
  assert.equal(legacyPeopleTutorHref({ docs: 'waiting' }), '/admin/users?tab=tutors&stage=waiting')
  assert.equal(legacyPeopleTutorHref({ paid: 'paid' }), '/admin/users?tab=tutors&stage=paid')
  assert.equal(legacyPeopleTutorHref({ docs: 'partial', q: 'x' }), '/admin/users?tab=tutors&stage=missing&q=x')
  assert.equal(legacyPeopleTutorHref({}), null)
  // Retired Overview rows open People.
  assert.equal(RETIRED_OVERVIEW_KEYS['todo-ready-to-pay'], '/admin/users?tab=tutors&stage=approved')
})

// ---------------------------------------------------------- who sees what ---

test('Backend Support sees the pipeline and the to-do rows, and no money', () => {
  const BS = 'backend_support' as const
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.people))
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.unpaidSignups))
  assert.ok(!roleSatisfies(BS, SCREEN_ACCESS.paymentAmounts))
  for (const k of ['todo-fee-pending', 'todo-rejected-uninformed'] as const) {
    assert.ok((OVERVIEW_ITEM_KEYS as readonly string[]).includes(k))
    assert.ok(roleSatisfies(BS, SCREEN_ACCESS[OVERVIEW_ITEMS[k].screen]))
    assert.ok(!isMoneyItem(k))
  }
  // No amount on a pipeline card, the People page or a message.
  const tabs = read('app/admin/users/PeopleTabs.tsx')
  assert.match(tabs, /amount: null/)
  assert.ok(!/pkr\(/.test(tabs + read('components/admin/PipelineActions.tsx') + read('lib/tutorPipelineCardCore.ts')))
  // Tuitions staff keep the tutor follow-ups they had, and no other People tab.
  assert.ok(roleSatisfies('tuitions_staff', SCREEN_ACCESS.people))
  assert.ok(!roleSatisfies('tuitions_staff', SCREEN_ACCESS.usersView))
  // The to-do rows: Documents to approve, then Fee pending, then Rejected, not informed.
  const page = read('app/admin/page.tsx')
  const start = page.indexOf('= [', page.indexOf('const TODO_KEYS'))
  const todo = page.slice(start, page.indexOf(']', start))
  assert.ok(todo.indexOf("'todo-fee-pending'") > todo.indexOf("'todo-docs'"))
  assert.ok(todo.indexOf("'todo-rejected-uninformed'") > todo.indexOf("'todo-fee-pending'"))
  assert.ok(!todo.includes("'todo-ready-to-pay'"))
})

test('deleted accounts appear only under Deleted', () => {
  type Tags = Record<string, unknown>
  const rows: { id: string; tags: Tags }[] = [
    { id: 'real', tags: { excluded: false, deleted: false, ni: false, stage: 'missing' } },
    { id: 'ni', tags: { excluded: false, deleted: false, ni: true, stage: 'missing' } },
    { id: 'test', tags: { excluded: true, deleted: false, ni: false, stage: 'missing' } },
    { id: 'gone', tags: { excluded: true, deleted: true, ni: false, stage: 'missing' } },
  ]
  // admin_list_page's p_fixed rule: jsonb containment.
  const view = (fixed: Tags) => rows.filter((r) => Object.entries(fixed).every(([k, v]) => r.tags[k] === v)).map((r) => r.id)
  // The People default view (as PeopleTabs builds it), the Not interested chip, "Show staff & test", Deleted.
  assert.deepEqual(view({ ...peopleFixed('real'), ni: false }), ['real'])
  assert.deepEqual(view({ ...peopleFixed('real'), ni: true }), ['ni'])
  assert.deepEqual(view(peopleFixed('all')), ['real', 'ni', 'test'])
  assert.deepEqual(view(peopleFixed('deleted')), ['gone'])
  const tabs = read('app/admin/users/PeopleTabs.tsx')
  assert.match(tabs, /\.\.\.peopleFixed\(view\),/)
  assert.match(tabs, /isTutors && view === 'real' && !signed \? \{ ni: showNi \}/)
  // The badge and the Overview rows use the real tutors only (inTab(…, false)).
  assert.match(read('lib/tutorPipeline.ts'), /inTab\(dir\.people, 'tutor', false\)/)
})
