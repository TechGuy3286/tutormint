/**
 * scripts/test-pr106g6.ts  —  npm run test:pr106g6
 *
 * PR106-G6 onboarding polish: tap-tap subjects (chips, multi-select, no
 * dropdown), empty availability, a plain optional email step, full-width
 * photo/selfie/CNIC buttons with Retake/Choose another, going back keeps every
 * value (incl. upload thumbnails), an auto-growing bio box, and no amount on the
 * final screen or the dashboard card. Source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const FLOW = read('components/tutor/NewOnboardingFlow.tsx')

function fnBody(name: string): string {
  const start = FLOW.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} exists`)
  const after = FLOW.indexOf('\nfunction ', start + 1)
  return FLOW.slice(start, after === -1 ? undefined : after)
}

// --------------------------------------------- STEP 1: subjects tap-tap -----
test('subjects step is tap-tap chips (no dropdown, multi-select), Next needs a subject', () => {
  const s = fnBody('SubjectsStep')
  assert.ok(!/TaxonomySelector/.test(FLOW), 'the new flow no longer uses the dropdown TaxonomySelector')
  assert.ok(!/<select/.test(FLOW), 'no <select> dropdown anywhere in the flow')
  assert.match(s, /OChip/, 'level and subjects render as tap chips (OChip)')
  assert.match(s, /fetchTaxonomyTree/, 'builds the level/subject tree')
  assert.match(s, /toggleCat/, 'levels are multi-select')
  assert.match(s, /toggleSub/, 'subjects are multi-select')
  assert.match(s, /nextDisabled: total === 0/, 'Next disabled until at least one subject')
  assert.ok(!/Choose a level and grade above/.test(FLOW), 'the helper text is removed')
  // OChip selected style = light green + tick + deep-green border
  const chip = fnBody('OChip')
  assert.match(chip, /border-tm-green-deep bg-tm-tint-green text-tm-green-deep/, 'selected chip style')
  assert.match(chip, /Check/, 'selected chip shows a tick')
})

// --------------------------------------------- STEP 2: availability ---------
test('availability opens empty — no preselected slots', () => {
  const s = fnBody('AvailabilityStep')
  assert.match(s, /useState<DaySlot\[\]>\(initial\)/, 'empty by default (only saved slots prefill)')
  assert.match(s, /nextDisabled: slots\.length === 0/, 'Next disabled until one slot')
  assert.ok(!/COMMON_SLOTS/.test(FLOW), 'no common-slots preselect')
})

// --------------------------------------------- STEP 3: email step -----------
test('email step is one box + optional Next, no card / sub-heading / separate send button', () => {
  assert.ok(!/EmailCard/.test(FLOW), 'the EmailCard is gone')
  assert.match(FLOW, /placeholder="you@example\.com"/, 'one plain email box')
  assert.match(FLOW, /headingEn: 'Your email', headingUr: undefined/, 'heading "Your email", no Urdu')
  assert.match(FLOW, /if \(!e\) \{ next\(\); return \}/, 'empty Next continues — email optional')
  assert.match(FLOW, /\/api\/account\/email/, 'a valid email sends the confirmation link')
  assert.ok(!/Send confirmation link/.test(FLOW), 'no separate "Send confirmation link" button')
})

// --------------------------------------------- STEP 4 & 8: full-width -------
test('photo/selfie buttons are full-width, one per row, with Retake/Choose another', () => {
  const c = fnBody('CaptureButtons')
  assert.ok(!/grid grid-cols-2/.test(c), 'no two-in-a-row grid — buttons are full width')
  assert.match(c, /w-full items-center justify-center gap-1\.5 whitespace-nowrap rounded-xl bg-tm-navy/, 'full-width navy "Open camera" on one line')
  assert.match(c, /w-full items-center justify-center gap-1\.5 whitespace-nowrap rounded-xl bg-tm-green-deep/, 'full-width deep-green "Choose from gallery"')
  assert.match(c, /done \? 'Retake photo' : 'Open camera'/, 'camera label switches to Retake photo')
  assert.match(c, /done \? 'Choose another' : 'Choose from gallery'/, 'gallery label switches to Choose another')
})

test('CNIC photos stack vertically, per-side English label, full-width buttons, Retake/Choose another', () => {
  const n = fnBody('NewCnicPhotos')
  assert.ok(!/grid grid-cols-2/.test(n), 'sides are stacked, not side by side')
  assert.match(n, /space-y-5/, 'vertical stack')
  const c = fnBody('CnicSideCapture')
  assert.match(c, /side === 'front' \? 'Front of CNIC' : 'Back of CNIC'/, 'per-side English label')
  assert.ok(!/grid grid-cols-2/.test(c), 'no four small buttons on one line')
  assert.match(c, /w-full[^]*bg-tm-navy[^]*has \? 'Retake photo' : 'Take a photo'/, 'full-width navy Take/Retake')
  assert.match(c, /w-full[^]*bg-tm-green-deep[^]*has \? 'Choose another' : 'Upload a file'/, 'full-width green Upload/Choose another')
})

// --------------------------------------------- STEP 5: back keeps data ------
test('going back keeps data: thumbnails reload and drafts survive', () => {
  // Facts carries preview URLs + the subjects draft
  assert.match(FLOW, /selfiePreview: string \| null/, 'Facts has a selfie preview')
  assert.match(FLOW, /cnicFrontPreview: string \| null/, 'Facts has a CNIC front preview')
  assert.match(FLOW, /subjCats: string\[\]/, 'Facts holds the subjects draft')
  // load() builds the preview URLs from the user's own documents
  assert.match(FLOW, /previewUrl\(selfieDoc\?\.id\)/, 'selfie thumbnail loaded on open')
  assert.match(FLOW, /previewUrl\(latest\('cnic', 'front'\)\?\.id\)/, 'CNIC front thumbnail loaded')
  // upload steps init from the saved preview
  assert.match(fnBody('SelfieStep'), /useState<string \| null>\(initialPreview\)/, 'selfie shows the saved thumbnail')
  assert.match(fnBody('CnicSideCapture'), /useState<string \| null>\(initialPreview\)/, 'CNIC side shows the saved thumbnail')
  // typed drafts sync to the parent so back/forward keeps them
  assert.match(fnBody('TaglineStep'), /onDraft\(\{ headline: v \}\)/, 'tagline draft kept')
  assert.match(fnBody('TaglineStep'), /onDraft\(\{ bio: v \}\)/, 'bio draft kept')
  assert.match(fnBody('ContactStep'), /setFacts\(\(f\) => \(f \? \{ \.\.\.f, whatsapp: v \} : f\)\)/, 'WhatsApp draft kept')
  assert.match(fnBody('SubjectsStep'), /onDraft\(nextCats, nextByCat\)/, 'subjects draft kept')
})

// --------------------------------------------- STEP 6: bio auto-grow --------
test('the About-you box auto-grows and has no inner scroll', () => {
  const t = fnBody('TaglineStep')
  assert.match(t, /el\.style\.height = `\$\{el\.scrollHeight\}px`/, 'grows to fit content')
  assert.match(t, /min-h-\[12rem\] w-full resize-none overflow-hidden/, 'min ~8 lines, no inner scroll')
  assert.ok(!/دوبارہ لکھوائیں/.test(t), 'Rewrite with AI is English only')
})

// --------------------------------------------- STEP 7: no amount ------------
test('no "Rs 199" on the final screen or the dashboard card', () => {
  assert.ok(!/Rs 199/.test(fnBody('GetVerifiedStep')), 'final screen shows no amount')
  const card = read('components/tutor/GetVerifiedValueCard.tsx')
  assert.ok(!/Rs\s*\.?\s*199|Rs 199/.test(card), 'dashboard card shows no amount')
})
