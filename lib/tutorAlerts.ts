import 'server-only'

// lib/tutorAlerts.ts
//
// "Notify me when a matching tutor joins" (owner, 13 Oct 2026).
//
// A parent whose search found nobody leaves a mobile number or an email, with a
// clear opt-in. When a tutor who answers the search becomes visible, they get
// ONE message — an SMS or an email — and the request is closed. No marketing,
// no second message. A request lapses after 60 days. Nothing is deleted.
//
// The match is pure (lib/tutorFacetsCore.matchesAlert): same city, at least one
// searched subject, and not a tutor who was already listed for it.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { getSmsProvider } from '@/lib/sms'
import { deliverEmail } from '@/lib/notify'
import { normalisePkMobile, looksLikeEmail } from '@/lib/phone'
import { resolveSmartQuery } from '@/lib/smartSearch'
import { loadTutorIndexFresh } from '@/lib/tutorFacets'
import { alertLabel, alertOpen, alertSms, matchesAlert, type AlertContact, type IndexedTutor } from '@/lib/tutorFacetsCore'
import { SITE_URL } from '@/lib/siteUrl'

/** A mobile or an email, as the parent typed it → what we can message. */
export function readContact(raw: string): AlertContact | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.includes('@')) return looksLikeEmail(v) ? { channel: 'email', contact: v.toLowerCase() } : null
  const msisdn = normalisePkMobile(v)
  return msisdn ? { channel: 'sms', contact: msisdn } : null
}

export type AlertRequest = {
  contact: string
  consent: boolean
  q?: string | null
  city?: string | null
  area?: string | null
  /** A subject chosen from the dropdown (one taxonomy id). */
  subjectId?: number | null
  userId?: string | null
}

export async function createTutorAlert(input: AlertRequest): Promise<{ ok: true; channel: 'sms' | 'email'; label: string } | { ok: false; status: number; error: string }> {
  if (!input.consent) return { ok: false, status: 400, error: 'Tick the box to agree to one message, then try again.' }
  const contact = readContact(input.contact)
  if (!contact) return { ok: false, status: 400, error: 'Enter a mobile number like 0300 1234567, or an email address.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }

  // What was searched, as the filters the match is made on.
  const q = (input.q ?? '').trim().slice(0, 200)
  const smart = q ? await resolveSmartQuery(q) : null
  const masterIds = input.subjectId ? [input.subjectId] : (smart?.masterIds ?? smart?.levelMasterIds ?? [])
  const city = (input.city ?? '').trim() || smart?.parsed.city || null
  const area = (input.area ?? '').trim() || null
  if (!city && masterIds.length === 0) {
    return { ok: false, status: 400, error: 'Choose a city or a subject first, so we know which tutor to tell you about.' }
  }

  let subject = smart?.parsed.subject?.name ?? null
  let level = smart?.parsed.levelLabel ?? null
  if (input.subjectId && !subject) {
    const { data: m } = await admin.from('taxonomy_master').select('level_slug, subject_slug').eq('id', input.subjectId).maybeSingle()
    if (m) {
      const [{ data: l }, { data: s }] = await Promise.all([
        admin.from('taxonomy_levels').select('name').eq('slug', m.level_slug as string).maybeSingle(),
        m.subject_slug ? admin.from('taxonomy_subjects').select('name').eq('slug', m.subject_slug as string).maybeSingle() : Promise.resolve({ data: null }),
      ])
      level = (l?.name as string | undefined) ?? null
      subject = ((s as { name?: string } | null)?.name as string | undefined) ?? null
    }
  }
  const label = alertLabel({ level, subject, city, area }).slice(0, 160)

  // Tutors who already match are not "new" — remember them.
  const index = await loadTutorIndexFresh().catch(() => [] as IndexedTutor[])
  const known = index.filter((t) => matchesAlert({ city, masterIds, knownTutorIds: [] }, t)).map((t) => t.id)

  const { error } = await admin.from('tutor_search_alerts').insert({
    channel: contact.channel,
    contact: contact.contact,
    query: q || null,
    city,
    area,
    master_ids: masterIds.slice(0, 2000),
    label,
    known_tutor_ids: known,
    user_id: input.userId ?? null,
  })
  // 23505: the same request is already open — the same answer for the parent.
  if (error && error.code !== '23505') return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  return { ok: true, channel: contact.channel, label }
}

type AlertRow = {
  id: string
  channel: 'sms' | 'email'
  contact: string
  city: string | null
  master_ids: number[] | null
  label: string
  known_tutor_ids: string[] | null
  expires_at: string
  notified_at: string | null
  closed_at: string | null
}

/**
 * The sweep (every few minutes, from the cron): close requests past 60 days,
 * and send the ONE message for each open request a newly visible tutor
 * answers. A request is closed before its message goes out, so a retry or two
 * overlapping runs can never send a second one.
 */
export async function sweepTutorAlerts(now = new Date()): Promise<{ open: number; sent: number; expired: number; failed: number }> {
  const out = { open: 0, sent: 0, expired: 0, failed: 0 }
  const admin = createAdminClient()
  if (!admin) return out
  let rows: AlertRow[] = []
  try {
    rows = (await pageAll((from, to) =>
      admin
        .from('tutor_search_alerts')
        .select('id, channel, contact, city, master_ids, label, known_tutor_ids, expires_at, notified_at, closed_at')
        .is('closed_at', null)
        .order('created_at')
        .range(from, to),
    )) as AlertRow[]
  } catch {
    return out // before migration 167
  }
  if (rows.length === 0) return out
  const iso = now.toISOString()

  const live: AlertRow[] = []
  for (const r of rows) {
    if (alertOpen(r, now.getTime())) live.push(r)
    else if (!r.notified_at) {
      const { data } = await admin.from('tutor_search_alerts').update({ closed_at: iso, close_reason: 'expired' }).eq('id', r.id).is('closed_at', null).select('id')
      if (data && data.length) out.expired++
    }
  }
  out.open = live.length
  if (live.length === 0) return out

  const index = await loadTutorIndexFresh().catch(() => [] as IndexedTutor[])
  if (index.length === 0) return out

  for (const r of live) {
    const tutor = index.find((t) => matchesAlert({ city: r.city, masterIds: r.master_ids ?? [], knownTutorIds: r.known_tutor_ids ?? [] }, t))
    if (!tutor || !tutor.slug) continue
    // Close first (guarded on still-open), then send: one message, ever.
    const { data: claimed } = await admin
      .from('tutor_search_alerts')
      .update({ closed_at: iso, notified_at: iso, close_reason: 'notified', matched_tutor_id: tutor.id })
      .eq('id', r.id)
      .is('closed_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue
    const url = `${SITE_URL}/tutor/${tutor.slug}`
    let ok = false
    try {
      if (r.channel === 'sms') ok = (await getSmsProvider().send(r.contact, alertSms(r.label, url))).ok
      else ok = (await deliverEmail({ email: r.contact }, { id: 'tutor_alert', label: r.label, url })).ok
    } catch {
      ok = false
    }
    if (ok) out.sent++
    else {
      out.failed++
      await admin.from('tutor_search_alerts').update({ close_reason: 'send_failed' }).eq('id', r.id)
    }
  }
  return out
}
