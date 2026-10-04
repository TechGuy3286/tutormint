/**
 * scripts/test-pr106g5.ts  —  npm run test:pr106g5
 *
 * PR106-G5: NewOnboardingFlow — no "Finish later" / skip links, availability
 * mandatory (with a one-tap common default), intro video not in the flow,
 * subjects never locked during onboarding (migration 134), grades rendered once
 * as chips, plain-English messages, and step errors shown at the top (never a
 * bottom toast over the fixed button). Source scans + pure values + the
 * migration. No browser, no DB, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { NEW_FLOW_ORDER } from '../lib/tutorFlow'
import { COMMON_SLOTS } from '../lib/timeSlots'
import { LOCKED_FIELD_MESSAGE } from '../lib/errorMessages'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const FLOW = read('components/tutor/NewOnboardingFlow.tsx')
const SHELL = read('components/onboarding/StepShell.tsx')
const TAX = read('components/TaxonomySelector.tsx')

// ------------------------------------------------- STEP 1: no exits midway --
test('no "Finish later" and no skip links anywhere in the new onboarding', () => {
  assert.ok(!/Finish later/.test(SHELL), 'StepShell header has no "Finish later"')
  assert.ok(!/export function StepSkip/.test(SHELL), 'StepSkip is gone')
  assert.ok(!/StepSkip/.test(FLOW), 'the flow imports/renders no StepSkip')
  assert.ok(!/Skip for now|>Skip<|I don.t use email/.test(FLOW), 'no skip links on any step')
  assert.ok(!/onFinishLater/.test(FLOW) && !/onFinishLater/.test(SHELL), 'onFinishLater removed everywhere')
  // the back arrow stays
  assert.match(SHELL, /aria-label="Back"/, 'the back arrow is kept')
})

test('availability is mandatory, with a one-tap common default', () => {
  assert.match(FLOW, /function AvailabilityStep/, 'availability step exists')
  assert.match(FLOW, /nextDisabled: slots\.length === 0/, 'Next needs at least one slot')
  assert.match(FLOW, /initial\.length > 0 \? initial : COMMON_SLOTS/, 'preselects the common default when none saved')
  assert.ok(COMMON_SLOTS.length >= 1, 'COMMON_SLOTS is non-empty (so it is one tap)')
})

test('the intro video step is not in the onboarding flow', () => {
  assert.ok(!NEW_FLOW_ORDER.includes('video' as never), 'no video step in NEW_FLOW_ORDER')
  assert.ok(!/stepKey === 'video'|'video'/.test(FLOW), 'the flow renders no video step')
  // it still lives on the dashboard (counts toward completion/ranking there)
  assert.match(read('app/(site)/tutor/dashboard/page.tsx'), /Intro video/, 'the dashboard keeps the Intro video tile')
})

// ------------------------------------------------- STEP 2: subjects --------
test('migration 134 removes the subjects lock so onboarding can always change them', () => {
  const m = read('supabase/migrations/134_unlock_tutor_subjects.sql')
  assert.match(m, /DROP TRIGGER IF EXISTS lock_tutor_subjects ON public\.tutor_subjects/, 'drops the subjects lock trigger')
  assert.ok(!/DROP .* lock_step1_set|DROP FUNCTION/.test(m), 'keeps the shared function (still backs tutor_areas)')
})

test('grades render once as tappable chips (no duplicate checkbox list)', () => {
  // the grade chips toggle on click and show the green/tick selected style
  assert.match(TAX, /onClick=\{\(\) => toggleGrade\(g\)\}/, 'grades are tappable chips')
  assert.match(TAX, /border-tm-green-deep bg-tm-tint-green text-tm-green-deep/, 'selected = light green + deep-green border')
  // the old grade checkbox list is gone (no checkbox wired to toggleGrade)
  assert.ok(!/onChange=\{\(\) => toggleGrade\(g\)\}/.test(TAX), 'no grade checkbox list remains')
  // the "select all" bulk action stays as a small text link
  assert.match(TAX, /Deselect all grades|Select all grades/, 'Select all / Deselect all text link kept')
})

// ------------------------------------------------- STEP 3: plain messages --
test('the locked-field message is plain English with the WhatsApp number', () => {
  assert.ok(!/can.t be changed here/i.test(LOCKED_FIELD_MESSAGE.en), 'no vague "can’t be changed here"')
  assert.match(LOCKED_FIELD_MESSAGE.en, /because your profile is approved/, 'says WHY it is locked')
  assert.match(LOCKED_FIELD_MESSAGE.en, /0321 5872222/, 'gives the WhatsApp number to act on')
})

test('step errors show at the TOP of the step, never as a bottom toast over the button', () => {
  // a top banner driven by flowError, cleared on step change
  assert.match(FLOW, /const \[flowError, setFlowError\] = useState<string \| null>\(null\)/, 'flowError state')
  assert.match(FLOW, /useEffect\(\(\) => \{ setFlowError\(null\) \}, \[stepKey\]\)/, 'cleared when the step changes')
  assert.match(FLOW, /\{flowError && \(\s*\n?\s*<div role="alert"[^]*mb-4/, 'rendered as a banner at the top of the content')
  // the save path sets the top banner, not a bottom toast
  assert.match(FLOW, /catch \(e\) \{\s*\n?\s*setBusy\(false\)\s*\n?\s*setFlowError\(/, 'saveAndNext routes the error to the top banner')
  assert.ok(!/toast\.error/.test(FLOW), 'no error toasts remain in the onboarding flow')
})
