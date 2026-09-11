/**
 * scripts/test-jobcontacts.ts
 *
 *   npm run test:jobcontacts
 *
 * Contact fields on admin-posted tuitions (owner, 11 Sep 2026). The four new
 * fields (WhatsApp, email, address, social) plus the existing name and phone all
 * live in job_contacts, never on the anon-readable jobs row, and are shown to
 * signed-in tutors only — never in metadata, JSON-LD, OG or the sitemap.
 *
 * Covers the owner's tests without a database:
 *   - the six fields round-trip through the job_contacts record shape;
 *   - a partially filled block yields only the filled fields (no empty rows);
 *   - none of the fields can appear in the public JobPosting JSON-LD (the builder
 *     takes only job fields — contact is a separate, service-role-only read).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildJobContact, normaliseStoredContact } from '../lib/jobContactCore'
import { jobPostingJsonLd } from '../lib/seo'

test('buildJobContact: all six fields round-trip into the job_contacts shape', () => {
  const r = buildJobContact({
    name: '  Bright Future Academy ',
    phone: '0300 1234567',
    whatsapp: '+92 321 9876543',
    email: '  Info@Academy.PK ',
    address: '  Block 5, Gulshan-e-Iqbal, Karachi ',
    social: '  facebook.com/brightfuture ',
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  // Phone and WhatsApp normalise to canonical MSISDN; email lowercases; free
  // text is trimmed. The record keys ARE the job_contacts columns.
  assert.deepEqual(r.record, {
    contact_name: 'Bright Future Academy',
    contact_phone: '923001234567',
    contact_whatsapp: '923219876543',
    contact_email: 'info@academy.pk',
    contact_address: 'Block 5, Gulshan-e-Iqbal, Karachi',
    contact_social: 'facebook.com/brightfuture',
  })
  assert.equal(r.hasContact, true)
})

test('buildJobContact: a partially filled block yields only the filled fields', () => {
  // Email only — every other field is null, so the page renders one row, no
  // empty rows and no stray labels.
  const r = buildJobContact({ email: 'parent@example.com' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.record, {
    contact_name: null,
    contact_phone: null,
    contact_whatsapp: null,
    contact_email: 'parent@example.com',
    contact_address: null,
    contact_social: null,
  })
  assert.equal(r.hasContact, true)
})

test('buildJobContact: an empty block is not a contact', () => {
  const r = buildJobContact({ name: '   ', phone: '', email: null })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.hasContact, false)
  assert.deepEqual(Object.values(r.record), [null, null, null, null, null, null])
})

test('buildJobContact: an invalid phone / WhatsApp / email is rejected by field', () => {
  const badPhone = buildJobContact({ phone: '12345' })
  assert.equal(badPhone.ok, false)
  if (!badPhone.ok) assert.equal(badPhone.field, 'phone')

  const badWa = buildJobContact({ whatsapp: 'not a number' })
  assert.equal(badWa.ok, false)
  if (!badWa.ok) assert.equal(badWa.field, 'whatsapp')

  const badEmail = buildJobContact({ email: 'not-an-email' })
  assert.equal(badEmail.ok, false)
  if (!badEmail.ok) assert.equal(badEmail.field, 'email')

  // A landline is not a mobile — rejected as a phone.
  const landline = buildJobContact({ phone: '0421234567' })
  assert.equal(landline.ok, false)
})

test('normaliseStoredContact: blanks become null, an all-empty row is null', () => {
  assert.equal(
    normaliseStoredContact({
      contact_name: '  ',
      contact_phone: '',
      contact_whatsapp: null,
      contact_email: '',
      contact_address: '   ',
      contact_social: '',
    }),
    null,
  )
  const r = normaliseStoredContact({ contact_email: ' a@b.co ', contact_address: null })
  assert.deepEqual(r, {
    contact_name: null,
    contact_phone: null,
    contact_whatsapp: null,
    contact_email: 'a@b.co',
    contact_address: null,
    contact_social: null,
  })
  assert.equal(normaliseStoredContact(null), null)
})

test('the JobPosting JSON-LD cannot carry any contact field', () => {
  // The builder takes ONLY job fields — there is no contact input — so a job
  // whose poster has a full contact block on file emits JSON-LD with none of it.
  // Address deliberately shares no words with the job's city/area, so an absent
  // match is about the contact block, not coincidental overlap.
  const contact = buildJobContact({
    name: 'Mrs. Khan',
    phone: '0300 1234567',
    whatsapp: '0321 9876543',
    email: 'mrs.khan@example.com',
    address: 'Flat 7B, Seaview Apartments',
    social: 'facebook.com/mrskhan',
  })
  assert.equal(contact.ok, true)
  if (!contact.ok) return

  const jsonLd = jobPostingJsonLd({
    url: 'https://www.tutormint.org/tuitions/lahore/o-level-physics-abc123',
    title: 'O Level Physics tutor needed',
    description: 'A tuition for O Level Physics in Lahore.',
    datePosted: '2026-09-11T00:00:00.000Z',
    city: 'Lahore',
    area: 'Model Town',
    subjects: ['O Level Physics'],
    budgetMin: 15000,
    budgetMax: 20000,
  })
  const serialised = JSON.stringify(jsonLd)

  for (const value of [
    'Mrs. Khan',
    '923001234567',
    '0300 1234567',
    '923219876543',
    'mrs.khan@example.com',
    'Flat 7B, Seaview Apartments',
    'facebook.com/mrskhan',
  ]) {
    assert.ok(!serialised.includes(value), `JSON-LD must not contain the contact value "${value}"`)
  }
})
