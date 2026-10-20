/**
 * scripts/test-header-timeline.ts  —  npm run test:headertimeline
 *
 * Admin header and member-page fixes (owner, 20 Oct 2026):
 *   • no "← Back to …" link in the shared admin header, on any admin page;
 *   • a plain-English timeline name for every event type (no underscores, no
 *     dotted codes, no camelCase);
 *   • a grouped long event ("Changed subjects ×23") stays short, with each
 *     edit under "Show each";
 *   • "Read number from photo" is disabled until a CNIC front is uploaded.
 * Pure logic + source scans + a server render of the trail — no database,
 * no names, numbers or emails printed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Breadcrumbs from '../components/Breadcrumbs'
import { adminTrail } from '../lib/adminNav'
import { AUDIT_LABELS, isPlainLabel, plainWords } from '../lib/timelineLabelsCore'
import { auditSentence, buildTimeline, type LogRow } from '../lib/memberTimelineCore'
import { timelineSentence } from '../lib/timelineText'
import { cnicReadButton, CNIC_READ_NEEDS_FRONT } from '../lib/cnicReadButtonCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// ── 1. No header back link ──────────────────────────────────────────────

const ID = '11111111-2222-4333-8444-555555555555'
function adminRoutes(): string[] {
  return walk(join(ROOT, 'app', 'admin'))
    .filter((p) => p.endsWith(`${sep}page.tsx`) && !p.includes('@pagehead'))
    .map((p) => '/' + relative(join(ROOT, 'app'), dirname(p)).split(sep).join('/'))
    .map((r) => r.replace('[key]', 'tutors').replace(/\[[^\]]+\]/g, ID))
}

test('admin header: no "Back to …" link on any admin page', () => {
  const head = read('app/admin/@pagehead/[...slug]/page.tsx')
  assert.match(head, /<Breadcrumbs items=\{crumbs\} showBack=\{false\} \/>/)
  const routes = adminRoutes()
  assert.ok(routes.length >= 50, `found ${routes.length} admin pages`)
  let hadIt = 0
  for (const r of routes) {
    const items = adminTrail(r, r.includes(ID) ? 'Record' : null).crumbs
    const before = renderToStaticMarkup(createElement(Breadcrumbs, { items }))
    if (before.includes('Back to')) hadIt++
    const after = renderToStaticMarkup(createElement(Breadcrumbs, { items, showBack: false }))
    assert.ok(!after.includes('Back to'), `back link still on ${r}`)
    // The trail is still there.
    assert.ok(after.includes('aria-label="Breadcrumb"'), r)
  }
  console.log(`  admin pages: ${routes.length}; had the header back link: ${hadIt}; have it now: 0`)
  assert.ok(hadIt > 0)
})

test('the public site keeps its back link', () => {
  const html = renderToStaticMarkup(createElement(Breadcrumbs, { items: [{ label: 'Tuitions', href: '/browse/tuitions' }, { label: 'A tuition' }] }))
  assert.ok(html.includes('Back to Tuitions'))
})

// ── 2. Plain labels for every event type ────────────────────────────────

/** Admin actions stored in admin_audit_log on 20 Oct 2026 (scripts/report-timeline-event-types.ts). */
const STORED_ACTIONS = [
  'account.delete', 'account.free_leftover', 'ad.create', 'ad.delete', 'ad.status', 'applicants.forward',
  'blog.approve', 'blog.cover_generate', 'blog.delete', 'blog.fix_ai', 'blog.fix_published',
  'blog.fix_redirect_links', 'blog.generate', 'blog.generate_test', 'blog.publish', 'blog.rename_fee',
  'blog.unpublish', 'cnic.reveal', 'document.owner_replace', 'document.restore_side', 'document.rotate',
  'flag.clear', 'indexing.skip_not_tuition', 'job.city_correct', 'job.close', 'job.contact_message',
  'job.edit', 'job.merge', 'job.pause', 'job.post', 'job.refresh', 'job.resume', 'location.alias',
  'location.area_add', 'location.landmark', 'location.not_area', 'location.run_review', 'member.delete',
  'member.email_unblock', 'member.export', 'member.follow_up', 'member.hide_public', 'member.message',
  'member.one_off_email', 'member.second_role', 'member.self_pause', 'member.self_restore',
  'member.suspend', 'member.unsuspend', 'member.warn', 'mfa.enroll', 'mobile.clear_verification',
  'notifications.fix_redirect_links', 'onboarding.mode', 'otp.reset', 'outreach.contact_logged',
  'parent.verify.approve', 'parent.verify.reject', 'payment.approve', 'payment.checkout_close',
  'payment.reject', 'payments.gateway', 'payments.switch', 'plan.grant', 'plan.revoke', 'plan.settings',
  'profile_photo.crop', 'profile_photo.rotate', 'reconciliation.import', 'report.action',
  'search_unmet.done', 'search.ignore', 'search.subject_add', 'settings.update', 'settlement.credit_add',
  'settlement.deduction_add', 'settlement.deduction_remove', 'settlement.link', 'sms.test',
  'social.generate', 'staff.create', 'staff.grant_existing', 'staff.invite_resend', 'staff.my_signups_open',
  'staff.my_signups_whatsapp', 'staff.reactivate', 'staff.remove', 'staff.role_change',
  'staff.signup_credit', 'staff.suspend', 'staff.targets_set', 'taxonomy.core', 'tutor.approve',
  'tutor.edit', 'tutor.hold', 'tutor.import', 'tutor.onboarding_done', 'tutor.slug', 'tutor.suspend',
  'tutor.unsuspend', 'tutor.verification_removed', 'user.delete', 'video.visibility', 'view_as_tutor',
]

/** Member events stored in user_activity_log on 20 Oct 2026. */
const STORED_EVENTS = [
  'account_self_paused', 'account_self_restored', 'admin_message_received', 'application_submitted',
  'cv_downloaded', 'document_uploaded', 'email_confirmed', 'fee_flag_cleared', 'follow_up_sent', 'imported',
  'job_edited', 'job_posted', 'login', 'message_sent', 'onboarding_done', 'otp_verified', 'password_changed',
  'payment_submitted', 'plan_granted', 'profile_claimed', 'profile_updated', 'profile_viewed', 'registered',
  'saved_job_added', 'saved_job_removed', 'search_performed', 'second_role_created', 'seeded_contact_messaged',
  'shortlist_added', 'staff_created', 'staff_removed', 'staff_role_changed', 'staff_suspended',
  'subjects_changed', 'suspended', 'terms_accepted', 'unsuspended', 'verification_decision_received',
  'verification_fee_paid', 'verification_submitted',
]

/** Every action the code writes: quoted literals, the AuditAction union, and the two template families. */
function codeActions(): string[] {
  const found = new Set<string>()
  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))].filter((p) => /\.tsx?$/.test(p))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/action: *['`]([a-z_]+(?:\.[a-z_]+)+)['`]/g)) found.add(m[1])
  }
  const union = read('lib/auditLog.ts').match(/export type AuditAction =([\s\S]*?)\n\n/)
  assert.ok(union, 'AuditAction union not found')
  for (const m of union[1].matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) found.add(m[1])
  for (const a of ['close', 'unfeature', 'pause', 'resume', 'refresh', 'merge']) found.add(`job.${a}`)
  for (const a of ['approve', 'hold', 'suspend', 'unsuspend']) found.add(`tutor.${a}`)
  return [...found]
}

function memberEvents(): string[] {
  const union = read('lib/activityLog.ts').match(/export type ActivityEvent =([\s\S]*?)\n\n/)
  assert.ok(union, 'ActivityEvent union not found')
  return [...new Set([...union[1].matchAll(/\| '([a-z_]+)'/g)].map((m) => m[1]).concat(STORED_EVENTS))]
}

test('every admin action has its own plain-English name', () => {
  const all = [...new Set([...codeActions(), ...STORED_ACTIONS])].sort()
  const missing = all.filter((a) => !AUDIT_LABELS[a])
  assert.deepEqual(missing, [], `no name for: ${missing.join(', ')}`)
  for (const a of all) {
    const label = auditSentence(a, null, 'Aqsa')
    assert.ok(isPlainLabel(label), `${a} → "${label}"`)
    assert.notEqual(label, plainWords(a), `${a} reads its own code`)
  }
  console.log(`  admin actions named: ${all.length}`)
})

test('every member event has its own plain-English sentence', () => {
  const events = memberEvents()
  for (const e of events) {
    const s = timelineSentence(e, {})
    assert.ok(isPlainLabel(s), `${e} → "${s}"`)
    const fallback = e.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
    assert.notEqual(s, fallback, `${e} reads its own code`)
  }
  // The template's code name is never shown.
  assert.equal(timelineSentence('follow_up_sent', { channel: 'whatsapp', templateKey: 'profile_completion_nudge' }), 'Followed up by staff on WhatsApp')
  console.log(`  member events named: ${events.length}`)
})

test('"<staff name> sent a WhatsApp from My sign-ups", with no extra "by" line', () => {
  assert.equal(auditSentence('staff.my_signups_whatsapp', null, 'Aqsa'), 'Aqsa sent a WhatsApp from My sign-ups')
  const items = buildTimeline(
    { logs: [], sessions: [], audits: [{ id: 'a1', action: 'staff.my_signups_whatsapp', detail: null, at: '2026-10-19T10:00:00Z', actorName: 'Aqsa' }] },
    'all',
  )
  assert.equal(items[0].text, 'Aqsa sent a WhatsApp from My sign-ups')
  assert.equal(items[0].who, null)
})

test('isPlainLabel rejects code-style text', () => {
  assert.equal(isPlainLabel('Staff my_signups whatsapp'), false)
  assert.equal(isPlainLabel('staff.my_signups'), false)
  assert.equal(isPlainLabel('Sent a mySignups WhatsApp'), false)
  assert.equal(isPlainLabel('Paused a tuition'), true)
})

// ── 3. A grouped long event stays short ─────────────────────────────────

test('timeline: 23 subject edits are one short line, each edit under Show each', () => {
  const longList = Array.from({ length: 30 }, (_, i) => `Grade ${i + 1} Mathematics and Further Mathematics`)
  const logs: LogRow[] = Array.from({ length: 23 }, (_, i) => ({
    id: `s${i}`,
    event: 'subjects_changed',
    meta: { added: longList, removed: longList.slice(0, 5), total: 40 + i },
    at: new Date(Date.parse('2026-10-19T19:47:00Z') - i * 10_000).toISOString(),
  }))
  const items = buildTimeline({ logs, audits: [], sessions: [] }, 'all')
  assert.equal(items.length, 1)
  const g = items[0]
  assert.equal(g.text, 'Changed subjects')
  assert.equal(g.count, 23)
  assert.ok(g.range)
  const line = `${g.text} ×${g.count} (${g.range})`
  assert.ok(line.length <= 60, `group line is ${line.length} characters`)
  assert.equal(g.children?.length, 23)
  assert.ok(g.children!.every((c) => c.text.startsWith('Changed subjects: added Grade 1')))
  // The row draws it on at most 2 lines.
  assert.match(read('app/admin/users/[id]/TimelineRow.tsx'), /e\.count > 1 \? 'line-clamp-2'/)
})

test('timeline: profile edits keep grouping under "Updated their profile"', () => {
  const logs: LogRow[] = [0, 1, 2].map((i) => ({
    id: `p${i}`, event: 'profile_updated', meta: { fields: [`field_${i}`] }, at: new Date(Date.parse('2026-10-19T10:00:00Z') - i * 60_000).toISOString(),
  }))
  const [g] = buildTimeline({ logs, audits: [], sessions: [] }, 'all')
  assert.equal(g.text, 'Updated their profile')
  assert.equal(g.count, 3)
})

// ── 4. Member-page values wrap ──────────────────────────────────────────

test('member page: Fact values wrap onto a second line, never "…"', () => {
  const src = read('app/admin/users/[id]/page.tsx')
  const fact = src.slice(src.indexOf('function Fact('), src.indexOf('function Panel('))
  assert.ok(!fact.includes('truncate'), 'Fact still truncates')
  assert.ok(fact.includes('break-words'))
})

// ── 5. Read number from photo ───────────────────────────────────────────

test('Read number from photo is disabled until a CNIC front is uploaded', () => {
  assert.deepEqual(cnicReadButton(false, false), { disabled: true, hint: CNIC_READ_NEEDS_FRONT })
  assert.equal(CNIC_READ_NEEDS_FRONT, 'Upload the CNIC front first')
  assert.deepEqual(cnicReadButton(true, false), { disabled: false, hint: null })
  assert.deepEqual(cnicReadButton(true, true), { disabled: true, hint: null })
  const box = read('components/admin/AdminCnicNumberBox.tsx')
  assert.match(box, /disabled=\{readBtn\.disabled\}/)
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /hasFrontPhoto=\{!!\(cnicFrontId \|\| rv\?\.cnicFrontId\)\}/)
})
