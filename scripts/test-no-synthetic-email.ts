// npm run test:nosyntheticemail — the auto-made <msisdn>@users.tutormint.org
// address is never displayed in admin; who made a change is shown by name and
// role (owner, 27 Oct 2026). Invented data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { actorLabel, actorKind, shownEmail } from '../lib/actorLabelCore'
import { staffLabel } from '../lib/followUpCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SYN = '923001234567@users.tutormint.org'

test('shownEmail hides the auto-made address and blanks', () => {
  assert.equal(shownEmail(SYN), null)
  assert.equal(shownEmail('923001234567+parent@users.tutormint.org'), null)
  assert.equal(shownEmail('  '), null)
  assert.equal(shownEmail('sana.ali@example.com'), 'sana.ali@example.com')
})

test('who made a change: kind + name, never the auto-made address', () => {
  assert.equal(actorLabel({ name: 'roha azeem', email: SYN, changedByRole: 'tutor' }), 'Tutor — Roha Azeem')
  assert.equal(actorLabel({ name: 'Khizra Danish', email: 'k@example.com', changedByRole: 'staff' }), 'Staff — Khizra Danish')
  assert.equal(actorLabel({ name: 'Hina Malik', role: 'parent', adminRole: 'member' }), 'Parent — Hina Malik')
  assert.equal(actorLabel({ name: null, email: SYN, changedByRole: 'tutor' }), 'Tutor')
  assert.equal(actorLabel({ name: '', email: 'x@example.com', adminRole: 'operations' }), 'Staff — x@example.com')
  assert.equal(actorKind({ adminRole: 'system' }), 'System')
  for (const s of [actorLabel({ email: SYN, adminRole: 'owner' }), actorLabel({ email: SYN, changedByRole: 'staff' })]) {
    assert.ok(!s.includes('users.tutormint.org'), s)
  }
})

test('a staff label never falls back to the digits of an auto-made address', () => {
  assert.equal(staffLabel(null, SYN), 'staff')
  assert.equal(staffLabel('Aqsa Mughal', SYN), 'Aqsa')
})

// Every admin .tsx that prints an email goes through shownEmail / a mask.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}
const RAW = /(?<![=$])\{\s*[\w.!?]+\.(email|actor_email|changed_by_email|byEmail|done_by_email)\s*(\?\?[^}]*)?\}/g
// Not a render: a prop (email={x}) is filtered by its component, a template
// ${x} is in a toast to staff. Known-real: a staff invite the Owner just typed.
const ALLOWED = /newAccount\.email|form\.email/

test('no admin screen renders a raw email', () => {
  const hits: string[] = []
  for (const file of [...walk(join(ROOT, 'app/admin')), ...walk(join(ROOT, 'components/admin'))]) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(RAW)) {
      if (ALLOWED.test(m[0])) continue
      hits.push(`${relative(ROOT, file)}: ${m[0]}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('change history and the audit log show the actor label', () => {
  assert.match(read('app/admin/tutors/[id]/TutorFieldHistory.tsx'), /changed_by_label/)
  assert.doesNotMatch(read('app/admin/tutors/[id]/TutorFieldHistory.tsx'), /changed_by_email \?/)
  assert.match(read('lib/fieldHistory.ts'), /actorLabel\(/)
  assert.match(read('lib/auditFeed.ts'), /actor_label = actorLabel\(/)
  assert.match(read('app/admin/audit/AuditEntry.tsx'), /actor_label/)
})

test('the tutor edit page masks the WhatsApp number with a logged Show', () => {
  const btn = read('components/admin/WhatsappChatButton.tsx')
  assert.match(btn, /<MaskedContact memberId=\{memberId\} field="whatsapp"/)
  assert.doesNotMatch(btn, /formatPkMobile\(target\.msisdn\)/)
  const route = read('app/api/admin/members/reveal-contact/route.ts')
  assert.match(route, /'whatsapp'/)
  assert.ok(route.indexOf('logAdminAction') < route.lastIndexOf('return NextResponse.json({ success: true, value }'))
})
