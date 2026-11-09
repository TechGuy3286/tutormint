// lib/tutorPipeline.ts
//
// The I/O half of the tutor pipeline on People (owner, 8 Nov 2026; rules in
// lib/tutorPipelineCore and lib/tutorPipelineCardCore). ONE loader for the
// People → Tutors list (via the admin summary job), the People badge and the
// Overview to-do rows, so every number is the length of what its view shows.
// Service role; callers check SCREEN_ACCESS first. Never logs a phone, email
// or CNIC number.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { runMemo } from '@/lib/runMemo'
import { loadDirectory, loadDirectoryDocs, inTab } from '@/lib/peopleDirectory'
import { loadNotInterested } from '@/lib/followUpDismissals'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { blankPhotoFlags } from '@/lib/photoBlank'
import { staffLabel } from '@/lib/followUpCore'
import { kindOfTemplateKey, legacyDocsApproved, stageOfProgress, type PipeContact } from '@/lib/tutorPipelineCore'
import { pipeCardFrom, pipeSortAt, pipeTags, withContacts, type PipeCard } from '@/lib/tutorPipelineCardCore'

export { pipeCardFrom, pipeDocsOf, pipeSortAt, pipeTags, followUpDue, feePendingDue, readyForReviewFrom, type PipeCard } from '@/lib/tutorPipelineCardCore'

const LIST = 'people:tutor'

/** Every contact with each tutor: Follow-ups records, logged calls, and call /
 *  WhatsApp notes. Undone and withdrawn ones are left out; parent follow-ups too. */
export async function loadPipeContacts(ids: string[]): Promise<Map<string, PipeContact[]>> {
  const out = new Map<string, PipeContact[]>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const push = (id: string, c: PipeContact) => out.set(id, [...(out.get(id) ?? []), c])
  const [fus, calls, notes] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('member_follow_ups')
        .select('id, member_id, created_at, channel, template_key, progress, source, staff_name, staff_email')
        .in('member_id', part)
        .is('undone_at', null)
        .order('id')
        .range(from, to),
    ).catch(() => []),
    pageAllIn(ids, (part, from, to) =>
      admin.from('tutor_contact_logs').select('id, tutor_id, created_at, staff_email').in('tutor_id', part).order('id').range(from, to),
    ).catch(() => []),
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('member_notes')
        .select('id, member_id, created_at, kind, staff_name')
        .in('member_id', part)
        .in('kind', ['call', 'whatsapp'])
        .is('withdrawn_at', null)
        .order('id')
        .range(from, to),
    ).catch(() => []),
  ])
  for (const r of fus) {
    if (r.source === 'parents') continue
    const progress = (r.progress as string | null) ?? null
    const kind = kindOfTemplateKey(r.template_key as string | null) ?? (r.channel === 'call' ? 'call' : 'whatsapp')
    push(r.member_id as string, {
      at: r.created_at as string,
      kind,
      stage: stageOfProgress(progress),
      docsApproved: legacyDocsApproved(progress),
      staffName: staffLabel(r.staff_name as string | null, r.staff_email as string | null),
    })
  }
  for (const r of calls)
    push(r.tutor_id as string, { at: r.created_at as string, kind: 'call', stage: null, docsApproved: null, staffName: staffLabel(null, r.staff_email as string | null) })
  for (const r of notes)
    push(r.member_id as string, {
      at: r.created_at as string,
      kind: r.kind === 'call' ? 'call' : 'whatsapp',
      stage: null,
      docsApproved: null,
      staffName: staffLabel(r.staff_name as string | null, null),
    })
  return out
}

/** Each member's newest visit. */
async function lastSeenFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('activity_sessions').select('id, user_id, last_seen_at').in('user_id', part).order('id').range(from, to),
  ).catch(() => [])
  for (const r of rows) {
    const id = r.user_id as string
    const at = r.last_seen_at as string | null
    if (at && (!out.has(id) || at > (out.get(id) as string))) out.set(id, at)
  }
  return out
}

/** Every tutor (every account in the Tutors tab, hidden and deleted included)
 *  with its pipeline card. Once per summary run. */
export const loadTutorPipeline = cache(
  (): Promise<Map<string, PipeCard>> =>
    runMemo('tutor-pipeline', async () => {
      const now = Date.now()
      const [dir, docs, ni, support, blank] = await Promise.all([loadDirectory(), loadDirectoryDocs(), loadNotInterested(), loadSupportWhatsApp(), blankPhotoFlags(null)])
      const tutors = inTab(dir.people, 'tutor', true)
      const ids = tutors.map((t) => t.id)
      const [contacts, seen] = await Promise.all([loadPipeContacts(ids), lastSeenFor(ids)])
      const out = new Map<string, PipeCard>()
      for (const t of tutors)
        out.set(
          t.id,
          pipeCardFrom({
            name: t.name,
            feePaid: !!t.feePaidAt,
            completion: t.completion,
            mobileOk: t.mobileOk,
            blank: blank.get(t.id) ?? [],
            docs: docs.get(t.id),
            contacts: contacts.get(t.id) ?? [],
            notInterested: ni.has(t.id),
            paused: t.suspended || t.banned || t.selfPaused,
            lastActiveAt: seen.get(t.id) ?? t.createdAt,
            support,
            nowMs: now,
          }),
        )
      return out
    }),
)

/**
 * After a follow-up is recorded or undone, the stored People row moves at once
 * (the summary job would only catch up within a few minutes). Only the
 * pipeline part of that one row is recomputed, from its stored stage. Never
 * throws.
 */
export async function refreshPipelineRow(memberId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    const { data } = await admin.from('admin_list_rows').select('tags, row').eq('list', LIST).eq('member_id', memberId).maybeSingle()
    const row = (data?.row ?? null) as { pipe?: PipeCard } | null
    if (!data || !row?.pipe) return
    const contacts = (await loadPipeContacts([memberId])).get(memberId) ?? []
    const next = withContacts(row.pipe, contacts, Date.now())
    await admin
      .from('admin_list_rows')
      .update({ tags: { ...(data.tags as Record<string, unknown>), ...pipeTags(next) }, row: { ...row, pipe: next }, sort_at: pipeSortAt(next) })
      .eq('list', LIST)
      .eq('member_id', memberId)
  } catch {
    /* the next summary run puts it right */
  }
}

/** "Not interested" (and its Undo) moves the stored People row at once. Never throws. */
export async function setPipelineNotInterested(memberId: string, ni: boolean): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    const { data } = await admin.from('admin_list_rows').select('tags, row').eq('list', LIST).eq('member_id', memberId).maybeSingle()
    if (!data) return
    const row = (data.row ?? {}) as { pipe?: PipeCard }
    await admin
      .from('admin_list_rows')
      .update({ tags: { ...(data.tags as Record<string, unknown>), ni }, row: row.pipe ? { ...row, pipe: { ...row.pipe, notInterested: ni } } : row })
      .eq('list', LIST)
      .eq('member_id', memberId)
  } catch {
    /* the next summary run puts it right */
  }
}

/** The real tutors (People's default view, Not interested left out) whose card
 *  matches — the Overview to-do rows read this. */
export async function pipelineRows(pick: (p: PipeCard) => boolean): Promise<{ id: string; name: string; card: PipeCard }[]> {
  const [dir, pipe] = await Promise.all([loadDirectory(), loadTutorPipeline()])
  return inTab(dir.people, 'tutor', false)
    .map((t) => ({ id: t.id, name: t.name, card: pipe.get(t.id) }))
    .filter((r): r is { id: string; name: string; card: PipeCard } => !!r.card && !r.card.notInterested && pick(r.card))
}
