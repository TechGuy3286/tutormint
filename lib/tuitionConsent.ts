import 'server-only'

// lib/tuitionConsent.ts
//
// The server half of parent consent for listings (owner, 27 Oct 2026). Rules
// are pure in lib/tuitionConsentCore. The consent rows live in the admin-only
// tuition_consents table (migration 208) and are read here through the service
// role; nothing about consent ever reaches a public page.

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { finishWaText, waSendHref } from '@/lib/waLinkCore'
import type { AdminRole } from '@/lib/adminAuth'
import {
  CONSENT_ASK_DEFAULT,
  CONSENT_ASK_KEY,
  HIDE_NUMBERS_SETTING,
  cleanConsentNote,
  fillConsentAsk,
  isStaffConsentMethod,
  numberHidden,
  parseHideSwitch,
  type ConsentMethod,
  type ConsentRecord,
  type ConsentStatus,
  type StaffConsentMethod,
} from '@/lib/tuitionConsentCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }

const NOT_RECORDED: ConsentRecord = { status: 'not_recorded', method: null, recordedByName: null, recordedAt: null, note: null }

function toRecord(r: Record<string, unknown> | null | undefined): ConsentRecord {
  if (!r) return NOT_RECORDED
  return {
    status: (r.status as ConsentStatus) === 'recorded' ? 'recorded' : 'not_recorded',
    method: (r.method as ConsentMethod | null) ?? null,
    recordedByName: (r.recorded_by_name as string | null) ?? null,
    recordedAt: (r.recorded_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }
}

/**
 * The Owner's switch, ON by default. Read once per request. A read that fails
 * reads as ON — an unreadable setting must never expose numbers.
 */
export const hideNumbersSwitchOn = cache(async (): Promise<boolean> => {
  const admin = createAdminClient()
  if (!admin) return true
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', HIDE_NUMBERS_SETTING).maybeSingle()
    return parseHideSwitch((data?.value as string | null) ?? null)
  } catch {
    return true
  }
})

/** Consent for each tuition (a missing row reads as Not recorded). */
export async function consentFor(jobIds: string[]): Promise<Map<string, ConsentRecord>> {
  const out = new Map<string, ConsentRecord>()
  const ids = [...new Set(jobIds.filter(Boolean))]
  if (ids.length === 0) return out
  const admin = createAdminClient()
  if (!admin) return out
  try {
    const rows = await pageAllIn(ids, (part, from, to) =>
      admin
        .from('tuition_consents')
        .select('job_id, status, method, recorded_by_name, recorded_at, note')
        .in('job_id', part)
        .order('job_id')
        .range(from, to),
    )
    for (const r of rows) out.set(r.job_id as string, toRecord(r))
  } catch {
    /* every tuition then reads as Not recorded — the safe side */
  }
  for (const id of ids) if (!out.has(id)) out.set(id, NOT_RECORDED)
  return out
}

/** Which of these tuitions have the parent's number hidden from tutors now. */
export async function hiddenNumberJobs(jobIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (jobIds.length === 0) return out
  if (!(await hideNumbersSwitchOn())) return out
  const consent = await consentFor(jobIds)
  for (const id of jobIds) if (numberHidden(true, consent.get(id))) out.add(id)
  return out
}

/** One tuition: is the parent's number hidden from tutors? */
export async function numberHiddenFor(jobId: string): Promise<boolean> {
  return (await hiddenNumberJobs([jobId])).has(jobId)
}

async function staffName(id: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

/**
 * Record a staff-given consent ("Parent agreed", or the tick on Post a
 * tuition / edit). Writes the row and an audit entry (never a phone number).
 */
export async function recordConsent(
  actor: Actor,
  jobId: string,
  input: { method: StaffConsentMethod; note?: string | null },
  via: 'post' | 'edit' | 'chip' | 'applications',
): Promise<{ ok: true; changed: boolean } | { ok: false; status: number; error: string }> {
  if (!isStaffConsentMethod(input.method)) return { ok: false, status: 400, error: 'Choose how the parent agreed.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: before } = await admin.from('tuition_consents').select('status, method, note').eq('job_id', jobId).maybeSingle()
  const note = cleanConsentNote(input.note)
  if (before?.status === 'recorded' && before.method === input.method && (before.note ?? null) === note) {
    return { ok: true, changed: false }
  }
  const now = new Date().toISOString()
  const { error } = await admin.from('tuition_consents').upsert(
    {
      job_id: jobId,
      status: 'recorded',
      method: input.method,
      recorded_by: actor.id,
      recorded_by_name: await staffName(actor.id),
      recorded_at: now,
      note,
      updated_at: now,
    },
    { onConflict: 'job_id' },
  )
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'job.consent_record',
    targetType: 'job',
    targetId: jobId,
    detail: { method: input.method, via, from: (before?.status as string | null) ?? 'not_recorded', hasNote: !!note },
  })
  return { ok: true, changed: true }
}

/** The Owner's switch, changed and logged. */
export async function setHideNumbersSwitch(actor: Actor, on: boolean): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const before = await hideNumbersSwitchOn()
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: HIDE_NUMBERS_SETTING, value: on ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'settings.hide_unconsented_numbers',
    targetType: 'app_settings',
    targetId: HIDE_NUMBERS_SETTING,
    detail: { from: before ? 'on' : 'off', to: on ? 'on' : 'off' },
  })
  return { ok: true }
}

/** How many tuitions have their number hidden right now (open or paused). */
export async function hiddenNumberCount(): Promise<{ hidden: number; switchOn: boolean }> {
  const switchOn = await hideNumbersSwitchOn()
  const admin = createAdminClient()
  if (!admin || !switchOn) return { hidden: 0, switchOn }
  const { count } = await admin
    .from('tuition_consents')
    .select('job_id, jobs!inner(status)', { count: 'exact', head: true })
    .eq('status', 'not_recorded')
    .in('jobs.status', ['open', 'paused'])
  return { hidden: count ?? 0, switchOn }
}

/**
 * "Ask parent": the WhatsApp link with the consent_ask message to the
 * tuition's parent number (job_contacts for a staff post). Built on the
 * server; the number never reaches the page. Null when there is no number.
 */
export async function consentAskLink(jobId: string, refCode: string | null): Promise<{ href: string } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [{ data: job }, { data: jc }, { data: tpl }] = await Promise.all([
    admin.from('jobs').select('id, title, ref_id').eq('id', jobId).maybeSingle(),
    admin.from('job_contacts').select('contact_name, contact_phone, contact_whatsapp').eq('job_id', jobId).maybeSingle(),
    admin.from('admin_message_templates').select('body').eq('key', CONSENT_ASK_KEY).maybeSingle(),
  ])
  if (!job) return null
  const msisdn = normalisePkMobile((jc?.contact_whatsapp as string | null) ?? null) ?? normalisePkMobile((jc?.contact_phone as string | null) ?? null)
  if (!msisdn) return null
  const firstName = formatName((jc?.contact_name as string | null) ?? null).split(' ')[0] || ''
  const text = fillConsentAsk((tpl?.body as string | null) ?? CONSENT_ASK_DEFAULT, {
    parentName: firstName,
    tuitionTitle: (job.title as string | null) ?? '',
    tmNumber: (job.ref_id as string | null) ?? '',
  })
  return { href: waSendHref(msisdn, finishWaText(text, refCode), refCode) }
}
