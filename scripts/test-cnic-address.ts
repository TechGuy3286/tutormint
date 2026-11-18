/**
 * scripts/test-cnic-address.ts — PR-07 (owner, 18 Nov 2026): the home address
 * read from the CNIC back, as a suggestion. INVENTED data only (a made-up
 * address; no image, no API call — the Claude API is mocked).
 *   - a failed or wrong-looking read (empty, no city, mostly symbols) saves nothing;
 *   - an address the member already entered is never overwritten (not even read);
 *   - only Confirm or Edit writes the address; Confirm needs a suggestion;
 *   - staff get the masked form with its label; the full address only through
 *     the reviewers' logged Show (logged BEFORE it is returned); never public.
 *
 *   npm run test:cnicaddress
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  ADDRESS_FROM_CNIC_NOTE,
  ADDRESS_LABEL_CONFIRMED,
  ADDRESS_LABEL_READ,
  addressSaveRefusal,
  alnumShare,
  maskAddress,
  memberSuggestion,
  parseAddressReading,
  runAddressRead,
  staffAddress,
  suggestionDecision,
  type AddressReading,
} from '../lib/cnicAddressCore'
import { mayRevealCnic } from '../lib/cnicRevealCore'
import { resolveCity } from '../lib/pkCitiesCore'
import { PK_CITIES } from '../lib/pkCityData'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const city = (t: string) => resolveCity(PK_CITIES, t)?.name ?? null

const GOOD = JSON.stringify({ address: 'House 12, Street 4, Invented Block, Gulberg III, Lahore', city: 'Lahore' })

// ------------------------------------------------------------ the reading ---

test('a clean reading is accepted with a known city', () => {
  assert.deepEqual(parseAddressReading(GOOD, city), { address: 'House 12, Street 4, Invented Block, Gulberg III, Lahore', city: 'Lahore' })
  // A fenced reply, and a city found in the address when the field is blank.
  const fenced = '```json\n' + JSON.stringify({ address: 'Flat 3, Invented Road, Saddar, Karachi', city: '' }) + '\n```'
  assert.equal(parseAddressReading(fenced, city)?.city, 'Karachi')
})

test('a failed or wrong-looking read is nothing: empty, none, prose, no city, mostly symbols', () => {
  for (const bad of [
    '',
    'none',
    'None.',
    'The address is not clear.',
    '{"address": "", "city": "Lahore"}',
    '{"address": "none", "city": "Lahore"}',
    '{"address": "House 1", "city": "Lahore"}', // too short
    '{"address": "House 12, Invented Street, Some Place", "city": "Atlantis"}', // no known city
    '{"address": "#### %%% ### @@@ !!! ### ***", "city": "Lahore"}', // symbols
    '{"address": "12/3 -- 45/6 -- 78/9 -- ##/##", "city": "Lahore"}', // under two words
    '{"address": "House 12, Street 4, Lahore"', // broken JSON
  ]) {
    assert.equal(parseAddressReading(bad, city), null, `rejects ${JSON.stringify(bad)}`)
  }
  assert.ok(alnumShare('####@@@ab') < 0.7)
})

// ------------------------------------------------------------- never overwrite ---

test('an address the member entered is never overwritten; a confirmed one is kept', () => {
  assert.equal(suggestionDecision({ currentAddress: 'Invented typed address, Multan', existing: null }), 'has_address')
  assert.equal(suggestionDecision({ currentAddress: '   ', existing: null }), 'save')
  assert.equal(suggestionDecision({ currentAddress: null, existing: 'confirmed' }), 'decided')
  assert.equal(suggestionDecision({ currentAddress: null, existing: 'edited' }), 'decided')
  assert.equal(suggestionDecision({ currentAddress: null, existing: 'unconfirmed' }), 'save', 'a newer CNIC back replaces an unconfirmed reading')
  // The member's own box hides a suggestion once they have an address.
  const s = { address: 'Invented, Lahore', city: 'Lahore', status: 'unconfirmed' as const }
  assert.equal(memberSuggestion('Typed address', s), null)
  assert.deepEqual(memberSuggestion('', s), s)
  assert.equal(memberSuggestion('', { ...s, status: 'confirmed' }), null)
})

type Calls = { claim: number; vision: number; saved: AddressReading[]; released: number }
function flow(over: Partial<Parameters<typeof runAddressRead>[0]> = {}) {
  const calls: Calls = { claim: 0, vision: 0, saved: [], released: 0 }
  const deps: Parameters<typeof runAddressRead>[0] = {
    decision: async () => 'save',
    claim: async () => {
      calls.claim++
      return true
    },
    release: async () => {
      calls.released++
    },
    loadImage: async () => ({ mediaType: 'image/jpeg', base64: 'AAAA' }),
    vision: async () => {
      calls.vision++
      return { ok: true, text: GOOD }
    },
    resolveCity: city,
    save: async (r) => {
      calls.saved.push(r)
    },
    ...over,
  }
  return { calls, run: () => runAddressRead(deps) }
}

test('the read: saved once; a member with an address is not read at all', async () => {
  const ok = flow()
  assert.deepEqual(await ok.run(), { status: 'saved' })
  assert.equal(ok.calls.saved.length, 1)

  const has = flow({ decision: async () => 'has_address' })
  assert.deepEqual(await has.run(), { status: 'skipped' })
  assert.equal(has.calls.claim, 0, 'no claim')
  assert.equal(has.calls.vision, 0, 'no API call')
  assert.equal(has.calls.saved.length, 0)

  const twice = flow({ claim: async () => false })
  assert.deepEqual(await twice.run(), { status: 'already_read' })
})

test('a failed read saves nothing (and can be retried); a wrong-looking read saves nothing', async () => {
  const noKey = flow({ vision: async () => ({ ok: false, reason: 'no key' }) })
  assert.deepEqual(await noKey.run(), { status: 'unavailable' })
  assert.equal(noKey.calls.saved.length, 0)
  assert.equal(noKey.calls.released, 1, 'released for a retry')

  const noImage = flow({ loadImage: async () => null })
  assert.deepEqual(await noImage.run(), { status: 'unavailable' })
  assert.equal(noImage.calls.saved.length, 0)

  const throws = flow({ vision: async () => Promise.reject(new Error('timeout')) })
  assert.deepEqual(await throws.run(), { status: 'unavailable' })
  assert.equal(throws.calls.saved.length, 0)

  for (const text of ['none', '{"address": "*** ### ***", "city": "Lahore"}', '{"address": "House 12, Invented Street", "city": "Nowhere"}']) {
    const wrong = flow({ vision: async () => ({ ok: true, text }) })
    assert.deepEqual(await wrong.run(), { status: 'none' })
    assert.equal(wrong.calls.saved.length, 0, `nothing saved for ${text}`)
  }
})

// ------------------------------------------------------------ Confirm / Edit ---

test('Confirm needs a suggestion; Edit needs a real address', () => {
  const s = { address: 'Invented, Lahore', city: 'Lahore', status: 'unconfirmed' as const }
  assert.equal(addressSaveRefusal('confirm', { suggestion: s }), null)
  assert.ok(addressSaveRefusal('confirm', { suggestion: null }))
  assert.equal(addressSaveRefusal('edit', { suggestion: s, text: 'House 9, Invented Lane, Multan' }), null)
  assert.ok(addressSaveRefusal('edit', { suggestion: s, text: '  ' }))
  assert.ok(addressSaveRefusal('edit', { suggestion: null, text: 'x'.repeat(501) }))
  assert.equal(ADDRESS_FROM_CNIC_NOTE, 'We read this from your CNIC. Is this your current address?')
})

test('only Confirm or Edit writes the address, with the member’s own session; never logged', () => {
  const route = read('app/api/profile/address-suggestion/route.ts')
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /from\('profiles'\)\.update\(\{ address \}\)\.eq\('id', user\.id\)/)
  assert.match(route, /markSuggestionDecided\(user\.id, action === 'confirm' \? 'confirmed' : 'edited'\)/)
  assert.doesNotMatch(route, /meta: \{[^}]*address:/, 'no address in the activity log')
  // The reader never writes profiles.
  const reader = read('lib/cnicAddress.ts')
  assert.doesNotMatch(reader, /from\('profiles'\)\s*\.update/)
  assert.doesNotMatch(reader, /console\.(log|error|warn)/, 'nothing printed')
  // The upload starts the read only for a CNIC back.
  assert.match(read('app/api/documents/upload/route.ts'), /kind === 'cnic' && label === 'back'[^]*readAddressFromDocument/)
})

// ---------------------------------------------------------------- staff side ---

test('staff see a masked address with its label; the street never leaves the server', () => {
  const s = { address: 'House 12, Street 4, Invented Block, Gulberg III, Lahore', city: 'Lahore', status: 'unconfirmed' as const }
  const fromCnic = staffAddress(null, 'Lahore', s)
  assert.equal(fromCnic?.label, ADDRESS_LABEL_READ)
  assert.equal(fromCnic?.label, 'Read from CNIC — not confirmed')
  assert.equal(fromCnic?.masked, '•••••• (Lahore)')
  assert.ok(!fromCnic?.masked.includes('House'))
  const own = staffAddress('Typed address, Multan', 'Multan', s)
  assert.equal(own?.label, ADDRESS_LABEL_CONFIRMED)
  assert.equal(own?.label, 'Confirmed by member')
  assert.equal(own?.source, 'member', 'the member’s own address wins')
  assert.equal(staffAddress(null, null, null), null)
  assert.equal(staffAddress(null, null, { ...s, status: 'confirmed' }), null)
  assert.equal(maskAddress(null), '••••••')
  // The member page passes only the masked form to the review card.
  const page = read('app/admin/users/[id]/page.tsx')
  assert.doesNotMatch(page, /address: parentDocs\.address,/)
  assert.doesNotMatch(page, /address: tutorAddressDocs\.address,/)
  assert.match(page, /staffAddressFor\(id\)/)
})

test('Show is for reviewers only and is logged before the address is returned', () => {
  for (const r of ['owner', 'partner', 'backend_support']) assert.ok(mayRevealCnic(r), r)
  for (const r of ['admin', 'operations', 'tuitions_staff', 'supervisor', null]) assert.ok(!mayRevealCnic(r), String(r))
  const route = read('app/api/admin/members/address-reveal/route.ts')
  assert.match(route, /mayRevealCnic\(gate\.actor\.adminRole\)/)
  const logAt = route.indexOf("action: 'address.reveal'")
  const readAt = route.indexOf('await addressForReveal(')
  assert.ok(logAt > 0 && readAt > logAt, 'the audit row is written before the address is read and returned')
  assert.match(route, /private, no-store/)
})

test('staff-only and never public: the suggestions table is service-role only', () => {
  const sql = read('supabase/migrations/236_cnic_address_and_forward_alerts.sql')
  assert.match(sql, /alter table public\.address_suggestions enable row level security/)
  assert.match(sql, /revoke all on public\.address_suggestions from anon, authenticated/)
  assert.doesNotMatch(sql, /create policy/i)
})
