/**
 * scripts/test-applications-v31.ts — npm run test:applicationsv31
 * Owner, 23 Oct 2026 — Applications v3.1:
 *   - the Applied message moves the application to Forwarded, records the
 *     forward, and goes to Sent due in 3 days
 *   - Undo restores Applied, and is refused after any other change
 *   - the tutor dashboard reads "Shared with the parent" after it
 *   - the templates are seeded with exactly today's wording (byte-for-byte)
 *   - unknown placeholders are blocked; a price or superlative is a warning
 *   - Reset to default; the fallback when a template is empty
 *   - the support number comes from settings in every message
 *   - no phone or email in logs or timeline entries
 * Pure rules + source scans. No browser, no network, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { stageMessage, tutorUpdateMessage, SUPPORT_LINE, type StageMessageInput } from '../lib/applicationMessagesCore'
import {
  APPLIED_FORWARD_MESSAGE,
  dueState,
  forwardUndoProblem,
  FORWARD_UNDO_TEXT,
  sectionOf,
  UNDO_CHANGED,
  type FollowUpRecord,
  type ForwardUndoFacts,
} from '../lib/applicationFollowUpCore'
import {
  APP_TEMPLATES,
  APP_TEMPLATE_DEFAULTS,
  fillTemplate,
  resolveBody,
  STAGE_TEMPLATE,
  templateWarnings,
  unknownPlaceholders,
  appTemplateDef,
} from '../lib/applicationTemplatesCore'
import { templateDefault, templateSaveCheck, APPLICATIONS_GROUP } from '../lib/templateRules'
import { APPLICANTS_FORWARD_DEFAULT } from '../lib/applicantForwardCore'
import { STAGES, TUTOR_STAGE_TEXT, type BoardItem, type Stage } from '../lib/applicationStageCore'
import { siteLink } from '../lib/waLinkCore'

const code = (p: string) => readFileSync(p, 'utf8')
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-23T12:00:00Z')
const at = new Date(NOW).toISOString()

// ------------------------------------------- the v3 wording, frozen here --
// A copy of lib/applicationMessagesCore as shipped in 75b98ee (v3), so the
// templates can be proven to send exactly the same text.
const V3_SUPPORT = 'Need help? WhatsApp us on 0321 5872222.'
const PHONE_LIKE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const v3clean = (t: string | null | undefined) => (t ?? '').replace(PHONE_LIKE, '').replace(EMAIL_LIKE, '').replace(/\s{2,}/g, ' ').trim()
const v3first = (n: string | null | undefined, fb: string) => ((n ?? '').trim().split(/\s+/)[0] ?? '') || fb
const v3label = (ref: string | null, title: string) => {
  const t = v3clean(title) || 'your tuition'
  return ref ? `${ref} — ${t}` : t
}
const v3open = (c: string | null | undefined) => ((c ?? '').trim() ? `/browse/tuitions?city=${encodeURIComponent((c ?? '').trim())}` : '/browse/tuitions')
const v3compose = (lines: (string | null)[]) => [...lines.filter((l): l is string => l !== null), '', V3_SUPPORT].join('\n')
function v3stage(i: StageMessageInput): string {
  const tuition = v3label(i.ref, i.title)
  const tutor = v3clean(i.tutorName) || 'the tutor'
  const parentHi = `Assalam o Alaikum ${v3clean(v3first(i.parentName, ''))}`.trim()
  const tutorHi = `Assalam o Alaikum ${v3clean(v3first(i.tutorName, ''))}`.trim()
  const profile = i.tutorProfilePath ? siteLink(i.tutorProfilePath) : null
  switch (i.stage) {
    case 'applied':
      return v3compose([`${parentHi}, this is TutorMint about your tuition ${tuition}.`, `${tutor} has applied.${profile ? ' You can see their TutorMint profile here:' : ''}`, profile, 'Reply here if you would like to talk to them.'])
    case 'forwarded':
      return v3compose([`${parentHi}, this is TutorMint about your tuition ${tuition}.`, `We shared ${tutor}'s profile with you. Did you get a chance to contact them?`])
    case 'contacted':
      return v3compose([`${parentHi}, this is TutorMint about your tuition ${tuition}.`, `Would you like to arrange a demo lesson or an interview with ${tutor}? We can help set it up.`])
    case 'demo':
      return v3compose([`${parentHi}, this is TutorMint about your tuition ${tuition}.`, `How did the demo or interview with ${tutor} go? Would you like to go ahead with them?`])
    case 'hired':
      return v3compose([`${tutorHi}, congratulations on getting the tuition ${tuition}!`, 'Could you send us a short line about your experience with TutorMint? We would love to share it as a success story.'])
    case 'not_selected':
      return v3compose([`${tutorHi}, thank you for applying to ${tuition}.`, 'The parent chose another tutor this time. New tuitions are posted every day — here are the open ones in your city:', siteLink(v3open(i.tutorCity))])
    case 'no_response':
      return v3compose([`${tutorHi}, thank you for applying to ${tuition}.`, 'The parent has not replied to us. New tuitions are posted every day — here are the open ones in your city:', siteLink(v3open(i.tutorCity))])
  }
}
function v3update(name: string | null, items: { ref: string | null; title: string; stage: Stage }[]): string {
  const hi = `Assalam o Alaikum ${v3clean(v3first(name, ''))}`.trim()
  return v3compose([`${hi}, here is an update on your TutorMint applications:`, ...items.map((i) => `• ${v3label(i.ref, i.title)}: ${TUTOR_STAGE_TEXT[i.stage]}`), '', 'You can see them all on your dashboard:', siteLink('/tutor/dashboard')])
}

const inputs = (stage: Stage): StageMessageInput[] => [
  { stage, ref: 'TM-1303', title: 'Online Tutor Required | Grade 5', parentName: 'Sara Khan', tutorName: 'Rida Saeed', tutorProfilePath: '/tutor/rida-saeed-tutor', tutorCity: 'Lahore' },
  { stage, ref: 'TM-9', title: '', parentName: null, tutorName: null, tutorProfilePath: '/tutor/x', tutorCity: null },
  { stage, ref: null, title: 'Home Tutor | DHA', parentName: '  ', tutorName: 'Ali', tutorProfilePath: '/tutor/ali', tutorCity: 'Rahim Yar Khan' },
  { stage, ref: 'TM-77', title: 'Call 0300 1234567 now', parentName: 'mail@x.com Hina', tutorName: 'Rida 03001234567', tutorProfilePath: '/tutor/r', tutorCity: 'Karachi' },
]

// ------------------------------------------------- byte-for-byte seeding --

test('the templates send exactly the v3 wording (byte-for-byte)', () => {
  for (const s of STAGES) for (const i of inputs(s)) assert.equal(stageMessage(i), v3stage(i), `${s}: ${JSON.stringify(i)}`)
  for (const s of STAGES) for (const i of inputs(s)) assert.equal(stageMessage(i, { template: APP_TEMPLATE_DEFAULTS[STAGE_TEMPLATE[s]] }), v3stage(i))
  const items = [
    { ref: 'TM-1', title: 'Home Tutor Required', stage: 'applied' as Stage },
    { ref: 'TM-2', title: 'Online Tutor Required', stage: 'forwarded' as Stage },
  ]
  for (const name of ['Rida Saeed', null, 'Ali']) {
    assert.equal(tutorUpdateMessage(name, items), v3update(name, items))
    assert.equal(tutorUpdateMessage(name, []), v3update(name, []))
  }
  assert.equal(SUPPORT_LINE, V3_SUPPORT)
})

test('the migration seeds exactly the code defaults', () => {
  const sql = code('supabase/migrations/195_applications_v31.sql').replace(/\r\n/g, '\n')
  for (const t of APP_TEMPLATES) {
    const m = sql.match(new RegExp(`\\(\\$tm\\$${t.key}\\$tm\\$, \\$tm\\$[^$]*\\$tm\\$, \\$tm\\$[^$]*\\$tm\\$, \\$tm\\$([\\s\\S]*?)\\$tm\\$\\)`))
    assert.ok(m, `${t.key} is seeded`)
    assert.equal(m![1], t.defaultBody, `${t.key} seeded byte-for-byte`)
  }
  assert.match(sql, /on conflict \(key\) do nothing;\s*\n\s*insert into public\.app_settings/)
  assert.match(sql, /'support\.whatsapp', '923215872222'/)
})

test('the Applications group: 8 templates + the forward message, each with a recipient', () => {
  assert.deepEqual(
    APPLICATIONS_GROUP.map((t) => `${t.key}:${t.recipient}`),
    [
      'app_applied:parent',
      'app_forwarded:parent',
      'app_contacted:parent',
      'app_demo:parent',
      'app_hired:tutor',
      'app_not_selected:tutor',
      'app_no_response:tutor',
      'app_tutor_update:tutor',
      'applicants_forward:parent',
    ],
  )
  for (const t of APP_TEMPLATES) assert.deepEqual(unknownPlaceholders(t.defaultBody, t.placeholders), [], `${t.key} default uses only its placeholders`)
  for (const t of APP_TEMPLATES) assert.deepEqual(templateWarnings(t.defaultBody), [], `${t.key} default has no warning`)
})

// ----------------------------------------------------- placeholders -------

test('unknown placeholders are blocked; known ones save', () => {
  const r = templateSaveCheck('app_forwarded', 'Hi {parent_name}, {tutor_phone} and {oops} {oops}')
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.deepEqual(r.unknown, ['tutor_phone', 'oops'])
    assert.match(r.error, /not known: \{tutor_phone\}, \{oops\}/)
  }
  // {applications_list} belongs to the By-tutor message only.
  assert.equal(templateSaveCheck('app_applied', '{applications_list}').ok, false)
  assert.equal(templateSaveCheck('app_tutor_update', '{applications_list}\n{support_whatsapp}').ok, true)
  assert.equal(templateSaveCheck('applicants_forward', 'Hi {parent_name}: {tutor_list} ({area})').ok, true)
  assert.equal(templateSaveCheck('applicants_forward', 'Hi {tm_number}').ok, false)
  // Empty is refused for the group; other templates keep their old rules.
  assert.equal(templateSaveCheck('app_hired', '   ').ok, false)
  assert.equal(templateSaveCheck('cnic_unclear', 'Hi {name} {anything}').ok, true)
  // The route blocks with the server's check before saving.
  const route = code('app/api/admin/inbox/route.ts')
  assert.ok(route.indexOf('templateSaveCheck') < route.indexOf('await saveTemplate('))
  assert.match(route, /if \(!check\.ok\) return NextResponse\.json\(\{ error: check\.error/)
})

test('a price or a superlative is a warning, never a block', () => {
  for (const body of ['Fee is Rs 500.', 'Only PKR 999!', 'Pay 1,500 rupees', 'Just 3000/-', 'the best tutors', 'our top tutor', 'the largest network', 'No.1 site', 'No 1 site']) {
    assert.ok(templateWarnings(body).length > 0, body)
    const r = templateSaveCheck('app_forwarded', body)
    assert.equal(r.ok, true, `${body}: saves`)
    if (r.ok) assert.ok(r.warnings.length > 0)
  }
  for (const body of ['Assalam o Alaikum {parent_name}', 'TM-1303 stop by', 'first lesson', 'WhatsApp {support_whatsapp}', 'Grade 10 students']) {
    assert.deepEqual(templateWarnings(body), [], body)
  }
})

test('Reset to default writes the built-in wording', () => {
  for (const t of APP_TEMPLATES) assert.equal(templateDefault(t.key), APP_TEMPLATE_DEFAULTS[t.key])
  assert.equal(templateDefault('applicants_forward'), APPLICANTS_FORWARD_DEFAULT)
  assert.equal(templateDefault('cnic_unclear'), null)
  const route = code('app/api/admin/inbox/route.ts')
  assert.match(route, /reset: z\.literal\(true\)/)
  assert.match(route, /next = \{ \.\.\.current, body: def \}/)
  assert.match(route, /action: 'reset' in t \? 'template\.reset' : 'template\.edit'/)
  assert.match(route, /roleMayWrite\(gate\.actor\.adminRole, \['admin'\]\)/)
})

test('an empty, missing or broken template falls back to the default', () => {
  const def = appTemplateDef('app_forwarded')!
  for (const stored of [null, undefined, '', '   \n  ', 'Hi {not_a_placeholder}']) assert.equal(resolveBody(stored, def), def.defaultBody)
  assert.equal(resolveBody('Hi {parent_name}', def), 'Hi {parent_name}')
  const i = inputs('forwarded')[0]
  for (const stored of ['', '  ', null, '{bad}']) assert.equal(stageMessage(i, { template: stored }), v3stage(i))
  // An edited template is used.
  assert.equal(stageMessage(i, { template: 'Hello {parent_name} about {tm_number}.' }), 'Hello Sara about TM-1303.')
  assert.equal(tutorUpdateMessage('Rida', [], { template: '' }), v3update('Rida', []))
})

test('fill: an empty value leaves no stray space, dash or blank line', () => {
  assert.equal(fillTemplate('Hi {parent_name}, about {tm_number} — {tuition_title}.', { tuition_title: 'X' }), 'Hi, about X.')
  assert.equal(fillTemplate('a\n{profile_link}\nb', { profile_link: '' }), 'a\nb')
  assert.equal(fillTemplate('a\n\nb', {}), 'a\n\nb')
  assert.equal(fillTemplate('{x}$&{y}', { x: '$1', y: '$$' }), '$1$&$$')
})

// ------------------------------------------------- support from settings --

test('the support number comes from settings in every message', () => {
  const number = '0300 1112223'
  for (const s of STAGES) {
    const m = stageMessage(inputs(s)[0], { supportWhatsApp: number })
    assert.ok(m.endsWith(`Need help? WhatsApp us on ${number}.`), s)
    assert.ok(!m.includes('5872222'), s)
  }
  assert.ok(tutorUpdateMessage('Rida', [{ ref: 'TM-1', title: 'X', stage: 'applied' }], { supportWhatsApp: number }).endsWith(`WhatsApp us on ${number}.`))
  // Every template uses the placeholder, never a written number.
  for (const t of APP_TEMPLATES) {
    assert.match(t.defaultBody, /\{support_whatsapp\}/)
    assert.doesNotMatch(t.defaultBody, /\d{4}\s?\d{7}/)
  }
  // The server fills it from app_settings 'support.whatsapp' on every send and preview.
  const server = code('lib/applicationTemplates.ts')
  assert.match(server, /SUPPORT_WHATSAPP_SETTING = 'support\.whatsapp'/)
  assert.match(server, /from\('app_settings'\)\.select\('value'\)\.eq\('key', SUPPORT_WHATSAPP_SETTING\)/)
  const fu = code('lib/applicationFollowUps.ts')
  assert.equal(fu.match(/loadSupportWhatsApp\(admin\)/g)?.length, 2, 'stage and By-tutor sends read the setting')
  assert.match(code('app/admin/applications/page.tsx'), /loadSupportWhatsApp\(\)/)
  assert.match(code('app/admin/inbox/page.tsx'), /loadSupportWhatsApp\(\)/)
  for (const f of ['lib/applicationTemplatesCore.ts', 'lib/applicationFollowUps.ts', 'lib/templateRules.ts', 'app/admin/inbox/ApplicationTemplates.tsx']) {
    assert.doesNotMatch(code(f).replace(/placeholder="0321 5872222"/, ''), /5872222/, `${f}: no written number`)
  }
  // Owner-only edit, audited masked.
  const route = code('app/api/admin/settings/support-whatsapp/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.supportNumber\)/)
  assert.match(route, /adminRole !== 'owner'/)
  assert.match(code('lib/adminAccessCore.ts'), /supportNumber: \[\] as AdminRole\[\]/)
  assert.match(server, /before: mask\(before\), after: mask\(msisdn\)/)
})

// ---------------------------------------------- Part A: Applied = forward --

const B = (p: Partial<BoardItem> = {}): BoardItem => ({
  id: 'a1',
  stage: 'forwarded',
  stageChangedAt: at,
  ownerId: 'aqsa',
  createdAt: new Date(NOW - 2 * DAY).toISOString(),
  workedAt: at,
  jobCreatedAt: new Date(NOW - 5 * DAY).toISOString(),
  ...p,
})
const rec = (p: Partial<FollowUpRecord> = {}): FollowUpRecord => ({
  id: 'f1',
  applicationId: 'a1',
  stage: 'forwarded',
  kind: 'follow_up',
  recipient: 'parent',
  messageKey: APPLIED_FORWARD_MESSAGE,
  staffName: 'Aqsa',
  at,
  ...p,
})

test('the Applied message moves to Forwarded, records the forward, and is Sent due in 3 days', () => {
  const due = dueState(B(), [rec()], NOW)
  assert.equal(due.tab, 'sent')
  assert.equal(sectionOf(due), 'sent')
  assert.equal(due.dueAt, new Date(NOW + 3 * DAY).toISOString())
  assert.equal(due.overdue, null)
  assert.equal(due.last?.messageKey, 'share_profile')
  // Three days on, it is due again under the Forwarded rule.
  assert.equal(dueState(B(), [rec()], NOW + 3 * DAY).tab, 'todo')
  assert.equal(dueState(B(), [rec()], NOW + 3 * DAY).overdue, 'check_in')

  const fu = code('lib/applicationFollowUps.ts')
  const send = fu.slice(fu.indexOf('export async function sendStageFollowUp'), fu.indexOf('async function forwardByAppliedMessage'))
  assert.match(send, /if \(stage === 'applied'\) \{\s*const ids = await forwardByAppliedMessage/)
  const fwd = fu.slice(fu.indexOf('async function forwardByAppliedMessage'), fu.indexOf('/**\n * By tutor'))
  // One time stamp for the stage, the forward and the follow-up.
  assert.match(fwd, /writeStage\(admin, actor, name, \{ \.\.\.app, stage: 'applied' \}, 'forwarded', 'applied message sent to parent', at\)/)
  assert.match(fwd, /from\('applicant_forwards'\)\s*\.insert\(\{ job_id: app\.job_id, channel: FORWARD_CHANNEL, tutor_ids: \[app\.tutor_id\][^}]*created_at: at \}\)/)
  assert.match(fwd, /action: 'applicants\.forward'/)
  assert.match(fwd, /stage: 'forwarded' \}\],\s*'follow_up',\s*'parent',\s*\(\) => APPLIED_FORWARD_MESSAGE,\s*\{ at, forwardId: fwd\.id as string, restore \}/)
  // The follow-up carries the same time and the activity time too.
  assert.match(fu, /created_at: extra\.at, forward_id: extra\.forwardId, restore: extra\.restore/)
  assert.match(fu, /const now = extra\?\.at \?\? new Date\(\)\.toISOString\(\)/)
  // The forward panel shows "already sent": forwards are read, undone ones left out.
  assert.match(code('lib/applicantForwards.ts'), /from\('applicant_forwards'\)\.select\('job_id, tutor_ids, created_at, staff_name, channel'\)\.is\('undone_at', null\)/)
})

test('the tutor dashboard reads "Shared with the parent" after it', () => {
  assert.equal(TUTOR_STAGE_TEXT.forwarded, 'Shared with the parent')
  assert.match(code('components/tutor/MyApplicationsSection.tsx'), /TUTOR_STAGE_TEXT\[c\.stage\]/)
})

const facts = (p: Partial<ForwardUndoFacts> = {}): ForwardUndoFacts => ({
  actorId: 'aqsa',
  nowMs: NOW + 5000,
  followUp: { staffId: 'aqsa', at, undoneAt: null },
  app: { stage: 'forwarded', stageChangedAt: at, workedAt: at, withdrawnAt: null },
  laterFollowUps: 0,
  ...p,
})

test('Undo restores Applied while nothing else has changed', () => {
  assert.equal(forwardUndoProblem(facts()), null)
  const fu = code('lib/applicationFollowUps.ts')
  const undo = fu.slice(fu.indexOf('async function undoAppliedForward'))
  assert.match(undo, /stage: 'applied',\s*stage_changed_at: restore\.stage_changed_at/)
  // Guarded: only a still-Forwarded row stamped by this very message moves back.
  assert.match(undo, /\.eq\('stage', 'forwarded'\)\s*\.eq\('stage_changed_at', fu\.created_at as string\)/)
  // Marked undone, never deleted.
  assert.match(undo, /from\('application_follow_ups'\)\.update\(\{ undone_at: now, undone_by: actor\.id \}\)/)
  assert.match(undo, /from\('applicant_forwards'\)\.update\(\{ undone_at: now, undone_by: actor\.id \}\)/)
  assert.doesNotMatch(undo, /\.delete\(/)
  // The undo route goes through undoFollowUps, which routes forward-kind ids here.
  assert.match(fu, /\.not\('forward_id', 'is', null\)/)
})

test('Undo is refused after another change, by anyone else, or late', () => {
  const later = { stage: 'forwarded', stageChangedAt: new Date(NOW + 1000).toISOString(), workedAt: at, withdrawnAt: null }
  assert.equal(forwardUndoProblem(facts({ app: later })), 'changed', 'a later stage change')
  assert.equal(forwardUndoProblem(facts({ app: { ...facts().app!, stage: 'contacted' } })), 'changed', 'moved on to Contacted')
  assert.equal(forwardUndoProblem(facts({ app: { ...facts().app!, workedAt: new Date(NOW + 2000).toISOString() } })), 'changed', 'a check-in tap')
  assert.equal(forwardUndoProblem(facts({ laterFollowUps: 1 })), 'changed', 'another follow-up')
  assert.equal(forwardUndoProblem(facts({ app: { ...facts().app!, withdrawnAt: at } })), 'changed', 'withdrawn')
  assert.equal(forwardUndoProblem(facts({ app: null })), 'changed')
  assert.equal(forwardUndoProblem(facts({ actorId: 'someone-else' })), 'not_yours')
  assert.equal(forwardUndoProblem(facts({ followUp: { staffId: 'aqsa', at, undoneAt: at } })), 'already_undone')
  assert.equal(forwardUndoProblem(facts({ nowMs: NOW + 61_000 })), 'too_late')
  assert.equal(FORWARD_UNDO_TEXT.changed, "Can't undo, the application has changed since")
  assert.equal(UNDO_CHANGED, FORWARD_UNDO_TEXT.changed)
  assert.match(code('lib/applicationFollowUps.ts'), /status: problem === 'not_yours' \? 403 : 409/)
})

// -------------------------------------------- no numbers in logs/timelines --

test('no phone or email in logs or timeline entries', () => {
  const files = ['lib/applicationFollowUps.ts', 'lib/applicationTemplates.ts', 'app/api/admin/inbox/route.ts', 'app/api/admin/settings/support-whatsapp/route.ts']
  for (const f of files) {
    const src = code(f)
    assert.doesNotMatch(src, /console\./, `${f}: nothing to the console`)
    // Every audit `detail` and timeline `meta` object: no number, email or message text.
    for (const m of src.matchAll(/(?:detail|meta): \{([^}]*)\}/g)) {
      // Keys only (shorthand `raw,` or `raw:`), so a value like channel: 'whatsapp' is fine.
      assert.doesNotMatch(m[1], /(?:^|[,{\s])(phone\w*|whatsapp|email|raw|href|text|body|msisdn|number)\s*(?::|,|$)/i, `${f}: ${m[1]}`)
    }
  }
  // Names and titles typed by people cannot carry a number or an address into a message.
  const m = stageMessage(inputs('applied')[3], { supportWhatsApp: '0321 0000000' })
  assert.doesNotMatch(m.replace('0321 0000000', ''), /\d{7,}|\d{4} \d{7}|@/)
})
