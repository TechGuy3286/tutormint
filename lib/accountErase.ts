// lib/accountErase.ts
//
// Close account and erase personal data (owner, 27 Oct 2026) — the I/O. Rules
// in lib/accountEraseCore.ts. Service role throughout; every caller checks who
// may ask first (the Owner: /api/admin/members/erase; the member themselves,
// after a code to their verified mobile: /api/account/delete).
//
//   scheduleErase()  — a row in account_erasures, due in 7 days (or now; then
//                      it runs at once)
//   cancelErase()    — until it has run
//   runErase()       — the erase itself
//   runDueErasures() — the daily cron
//
// The auth user is SCRUBBED, not deleted (migration 203, erase_auth_user): it
// is ON DELETE CASCADE into payments, applications, follow-ups, tuitions and the
// profile itself — the records the erase must keep.

import { createHash } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { deliverEmail } from '@/lib/notify'
import { recipientProblem, isSyntheticAddress } from '@/lib/notify/recipient'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { deleteVideo, youtubeConfigured } from '@/lib/youtube'
import { revalidateLanding } from '@/lib/landingRevalidate'
import {
  DELETED_MESSAGE,
  ERASE_BUCKETS,
  ERASE_CONFIRMATION,
  eraseAuditLine,
  eraseDueAt,
  eraseIsDue,
  eraseTargetProblem,
  filesToRemove,
  maskNote,
  normaliseSlug,
  profileErasePatch,
  scrubPaymentRaw,
  tutorErasePatch,
  type EraseMode,
  type StoredFile,
} from '@/lib/accountEraseCore'
import type { AdminRole } from '@/lib/adminAccessCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type Erasure = {
  id: string
  member_id: string
  status: 'scheduled' | 'cancelled' | 'done' | 'failed'
  source: 'owner' | 'member'
  requested_by: string | null
  requested_by_name: string | null
  reason: string | null
  identity_check: string | null
  requested_at: string
  due_at: string
  done_at: string | null
  cancelled_at: string | null
  error: string | null
  summary: Record<string, unknown>
}

const ERASURE_COLS = 'id, member_id, status, source, requested_by, requested_by_name, reason, identity_check, requested_at, due_at, done_at, cancelled_at, error, summary'

export function slugHash(slug: string): string {
  return createHash('sha256').update(normaliseSlug(slug)).digest('hex')
}

/** The newest erasure row for a member (any status), or null. */
export async function loadErasure(memberId: string): Promise<Erasure | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('account_erasures')
    .select(ERASURE_COLS)
    .eq('member_id', memberId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Erasure | null) ?? null
}

/** The scheduled erase of a member, or null. */
export async function loadPendingErasure(memberId: string): Promise<Erasure | null> {
  const e = await loadErasure(memberId)
  return e && e.status === 'scheduled' ? e : null
}

async function failedRowCarry(admin: Admin, erasureId: string): Promise<{ slug_hashes?: string[]; city?: string | null }> {
  const { data } = await admin.from('account_erasures').select('slug_hashes, city').eq('id', erasureId).maybeSingle()
  return data ? { slug_hashes: (data.slug_hashes as string[] | null) ?? [], city: (data.city as string | null) ?? null } : {}
}

type Requester = { kind: 'owner'; id: string; name: string; role: AdminRole; email: string | null } | { kind: 'member'; id: string }

export type ScheduleResult =
  | { ok: true; erasure: Erasure; ran: boolean; emailed?: boolean; confirmation?: string }
  | { ok: false; status: number; error: string }

export async function scheduleErase(args: {
  memberId: string
  by: Requester
  reason: string
  identityCheck: string
  mode: EraseMode
}): Promise<ScheduleResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: p } = await admin.from('profiles').select('id, role, admin_role, erased_at').eq('id', args.memberId).maybeSingle()
  const last = await loadErasure(args.memberId)
  const problem = eraseTargetProblem(p as never, { retry: last?.status === 'failed' })
  if (problem) return { ok: false, status: p ? 400 : 404, error: problem }
  const existing = await loadPendingErasure(args.memberId)
  if (existing && args.mode === 'later') return { ok: false, status: 409, error: 'An erase is already scheduled for this account.' }

  const due = eraseDueAt(Date.now(), args.mode).toISOString()
  let erasure: Erasure
  if (existing) {
    // "Erase now" on an account already scheduled: bring the date forward.
    const { data, error } = await admin
      .from('account_erasures')
      .update({ due_at: due, reason: args.reason.trim(), identity_check: args.identityCheck.trim() })
      .eq('id', existing.id)
      .select(ERASURE_COLS)
      .single()
    if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    erasure = data as Erasure
  } else {
    const { data, error } = await admin
      .from('account_erasures')
      .insert({
        member_id: args.memberId,
        role: (p as { role: string }).role,
        status: 'scheduled',
        source: args.by.kind,
        requested_by: args.by.id,
        requested_by_name: args.by.kind === 'owner' ? args.by.name : 'The member',
        reason: args.reason.trim(),
        identity_check: args.identityCheck.trim(),
        due_at: due,
        // A retry after a failed run keeps the addresses that run already hashed.
        ...(last?.status === 'failed' ? await failedRowCarry(admin, last.id) : {}),
      })
      .select(ERASURE_COLS)
      .single()
    if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    erasure = data as Erasure
  }

  await logAdminAction({
    actorId: args.by.id,
    actorRole: (args.by.kind === 'owner' ? args.by.role : 'member') as AdminRole,
    actorEmail: args.by.kind === 'owner' ? args.by.email : null,
    action: 'member.erase_scheduled',
    targetType: 'profile',
    targetId: args.memberId,
    detail: { mode: args.mode, dueAt: due, source: args.by.kind, reason: args.reason.trim() },
  })

  if (args.mode === 'now') {
    const r = await runErase(erasure)
    if (!r.ok) return { ok: false, status: 500, error: r.error }
    return { ok: true, erasure: { ...erasure, status: 'done' }, ran: true, emailed: r.emailed, confirmation: ERASE_CONFIRMATION }
  }
  return { ok: true, erasure, ran: false }
}

export async function cancelErase(args: { memberId: string; by: Requester }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const pending = await loadPendingErasure(args.memberId)
  if (!pending) return { ok: false, status: 404, error: 'There is no scheduled deletion to cancel.' }
  const { error } = await admin
    .from('account_erasures')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: args.by.id })
    .eq('id', pending.id)
    .eq('status', 'scheduled')
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: args.by.id,
    actorRole: (args.by.kind === 'owner' ? args.by.role : 'member') as AdminRole,
    actorEmail: args.by.kind === 'owner' ? args.by.email : null,
    action: 'member.erase_cancelled',
    targetType: 'profile',
    targetId: args.memberId,
    detail: { source: args.by.kind },
  })
  return { ok: true }
}

// ------------------------------------------------------------------ the erase

async function listFolder(admin: Admin, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const out: string[] = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error || !data || data.length === 0) break
    for (const item of data) {
      const full = `${prefix}/${item.name}`
      if (item.id === null) out.push(...(await listFolder(admin, bucket, full, depth + 1)))
      else out.push(full)
    }
    if (data.length < 100) break
  }
  return out
}

async function removeFiles(admin: Admin, files: StoredFile[]): Promise<{ removed: number; failed: number }> {
  const byBucket = new Map<string, string[]>()
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path])
  let removed = 0
  let failed = 0
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const part = paths.slice(i, i + 100)
      const { data, error } = await admin.storage.from(bucket).remove(part)
      if (error) failed += part.length
      else removed += data?.length ?? 0
    }
  }
  return { removed, failed }
}

export type RunResult = { ok: true; emailed: boolean } | { ok: false; error: string }

export async function runErase(erasure: Erasure): Promise<RunResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'service role unavailable' }
  const id = erasure.member_id
  const now = new Date().toISOString()

  const { data: p } = await admin.from('profiles').select('id, role, admin_role, erased_at, email, avatar_url, city').eq('id', id).maybeSingle()
  const problem = eraseTargetProblem(p as never, { retry: true })
  if (problem) {
    await admin.from('account_erasures').update({ status: 'failed', error: problem }).eq('id', erasure.id)
    return { ok: false, error: problem }
  }
  const prof = p as { role: string; email: string | null; avatar_url: string | null; city: string | null }

  try {
    // 1 — the confirmation email, BEFORE the address is erased.
    let emailed = false
    const email = (prof.email ?? '').trim()
    if (email && !isSyntheticAddress(email) && !recipientProblem(email)) {
      const r = await deliverEmail({ email }, { id: 'account_erased', supportWhatsapp: await loadSupportWhatsApp(admin) }).catch(() => null)
      emailed = !!r?.ok
    }

    // 2 — what to remove from storage.
    const { data: tp } = await admin
      .from('tutor_profiles')
      .select('id, slug, city, video_youtube_id, avatar_url, cover_image_url, cnic_front_url, cnic_back_url, selfie_url, video_intro_url, experience_letter_url')
      .eq('id', id)
      .maybeSingle()
    const { data: docs } = await admin.from('user_documents').select('original_path, preview_path').eq('user_id', id)
    const { data: pays } = await admin.from('payments').select('id, screenshot_path, refund_proof_path, raw').eq('user_id', id)
    const { data: atts } = await admin.from('messages').select('attachment_path').eq('sender_id', id).not('attachment_path', 'is', null)
    const { data: rot } = await admin.from('avatar_rotations').select('original_url, rotated_url').eq('user_id', id).maybeSingle()
    const t = (tp ?? {}) as Record<string, string | null>
    const files = filesToRemove({
      documents: (docs ?? []) as never,
      receipts: (pays ?? []) as never,
      messageAttachments: (atts ?? []).map((a) => a.attachment_path as string | null),
      publicUrls: [prof.avatar_url, t.avatar_url, t.cover_image_url, t.cnic_front_url, t.cnic_back_url, t.selfie_url, t.video_intro_url, t.experience_letter_url, rot?.original_url ?? null, rot?.rotated_url ?? null],
    })
    for (const bucket of ERASE_BUCKETS) {
      for (const path of await listFolder(admin, bucket, id)) files.push({ bucket, path })
    }
    const seen = new Set<string>()
    const unique = files.filter((f) => (seen.has(`${f.bucket}:${f.path}`) ? false : (seen.add(`${f.bucket}:${f.path}`), true)))
    const storage = await removeFiles(admin, unique)

    // 3 — the intro video on YouTube.
    let youtube: 'none' | 'deleted' | 'failed' | 'not configured' = 'none'
    if (t.video_youtube_id) {
      if (!youtubeConfigured()) youtube = 'not configured'
      else youtube = (await deleteVideo(t.video_youtube_id)).ok ? 'deleted' : 'failed'
    }

    // 4 — the old addresses of a tutor profile, as hashes, for the 301.
    const slugs = new Set<string>()
    if (t.slug) slugs.add(t.slug)
    const { data: hist } = await admin.from('slug_history').select('old_slug').eq('tutor_id', id)
    for (const h of hist ?? []) if ((h as { old_slug?: string }).old_slug) slugs.add((h as { old_slug: string }).old_slug)
    const city = (t.city as string | null) ?? prof.city ?? null
    // Kept on the request row BEFORE anything changes, so a retry after a
    // failure still knows the original addresses.
    const { data: prev } = await admin.from('account_erasures').select('slug_hashes, city').eq('id', erasure.id).maybeSingle()
    const hashes = [...new Set([...(((prev?.slug_hashes as string[] | null) ?? [])), ...[...slugs].filter((s) => !s.startsWith('deleted-')).map(slugHash)])]
    const keptCity = (prev?.city as string | null) ?? city
    await admin.from('account_erasures').update({ slug_hashes: hashes, city: keptCity }).eq('id', erasure.id)

    // 5 — the rows.
    const must = async (label: string, q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q
      if (error) throw new Error(`${label}: ${error.message}`)
    }
    // profiles first: erased_at set is what lets the notes be masked and hides
    // the tuitions (migration 203).
    await must('profile', admin.from('profiles').update(profileErasePatch(id, now)).eq('id', id))
    await must('linked', admin.from('profiles').update({ linked_account_id: null }).eq('linked_account_id', id))
    if (tp) await must('tutor profile', admin.from('tutor_profiles').update(tutorErasePatch(id)).eq('id', id))
    await must('areas', admin.from('tutor_areas').delete().eq('tutor_id', id))
    await must('field history', admin.from('tutor_field_history').delete().eq('tutor_id', id))
    await must('slug history', admin.from('slug_history').delete().eq('tutor_id', id))
    await must('documents', admin.from('user_documents').delete().eq('user_id', id))
    await must('photo rotation', admin.from('avatar_rotations').delete().eq('user_id', id))
    await must(
      'messages',
      admin.from('messages').update({ body: DELETED_MESSAGE, message: DELETED_MESSAGE, sender: DELETED_MESSAGE, attachment_path: null, attachment_w: null, attachment_h: null, attachment_bytes: null }).eq('sender_id', id),
    )
    await must('team messages', admin.from('admin_messages').update({ body: DELETED_MESSAGE }).eq('member_id', id).eq('direction', 'in'))
    await must('children', admin.from('children').update({ name: 'Child' }).eq('parent_id', id))
    await must('one-time codes', admin.from('phone_otps').delete().eq('user_id', id))
    await must('search alerts', admin.from('tutor_search_alerts').delete().eq('user_id', id))

    const { data: notes } = await admin.from('member_notes').select('id, body').eq('member_id', id)
    for (const n of notes ?? []) {
      const masked = maskNote(n.body as string)
      if (masked !== n.body) await must('note', admin.from('member_notes').update({ body: masked }).eq('id', n.id))
    }
    const { data: logs } = await admin.from('tutor_contact_logs').select('id, note').eq('tutor_id', id).not('note', 'is', null)
    for (const l of logs ?? []) {
      const masked = maskNote(l.note as string)
      if (masked !== l.note) await must('contact log', admin.from('tutor_contact_logs').update({ note: masked }).eq('id', l.id))
    }
    const { data: apps } = await admin.from('applications').select('id, message').eq('tutor_id', id).not('message', 'is', null)
    for (const a of apps ?? []) {
      const masked = maskNote(a.message as string)
      if (masked !== a.message) await must('application', admin.from('applications').update({ message: masked }).eq('id', a.id))
    }
    const { data: jobs } = await admin.from('jobs').select('id, description').eq('parent_id', id).not('description', 'is', null)
    for (const j of jobs ?? []) {
      const masked = maskNote(j.description as string)
      if (masked !== j.description) await must('tuition', admin.from('jobs').update({ description: masked }).eq('id', j.id))
    }
    // Payments stay — amount, date, method, bank reference. The receipt files
    // are gone (above); their paths and any personal field of the gateway
    // payload are cleared.
    for (const pay of pays ?? []) {
      await must(
        'payment',
        admin.from('payments').update({ screenshot_path: null, refund_proof_path: null, raw: scrubPaymentRaw(pay.raw ?? {}) }).eq('id', pay.id),
      )
    }
    if (email) await admin.from('messages').update({ recipient: DELETED_MESSAGE }).eq('recipient', email)
    if (email) await admin.from('email_sends').update({ recipient: '[deleted]' }).eq('recipient', email)

    // 6 — sign-in closed for good.
    await admin.rpc('revoke_user_sessions', { uid: id })
    await must('auth user', admin.rpc('erase_auth_user', { p_uid: id }))

    // 7 — done.
    const byName = erasure.source === 'member' ? 'the member' : erasure.requested_by_name || 'Owner'
    const line = eraseAuditLine({ reason: erasure.reason ?? 'Requested by the member', byName, at: now })
    const summary = { files: storage.removed, filesFailed: storage.failed, emailed, youtube, role: prof.role }
    await must(
      'erasure',
      admin
        .from('account_erasures')
        .update({ status: 'done', done_at: now, error: null, slug_hashes: hashes, city: keptCity, summary })
        .eq('id', erasure.id),
    )
    await logAdminAction({
      actorId: erasure.requested_by ?? id,
      actorRole: (erasure.source === 'member' ? 'member' : 'owner') as AdminRole,
      action: 'member.erase',
      targetType: 'profile',
      targetId: id,
      detail: { line, reason: erasure.reason, identityCheck: erasure.identity_check, source: erasure.source, ...summary },
    })
    try {
      revalidateLanding()
    } catch {
      /* the cached directory catches up on its own */
    }
    return { ok: true, emailed }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    await admin.from('account_erasures').update({ status: 'failed', error: msg.slice(0, 300) }).eq('id', erasure.id)
    console.error('[erase] failed for one account:', msg)
    return { ok: false, error: 'The erase did not finish. Nothing was lost; please try again.' }
  }
}

/** The daily cron: every scheduled erase whose 7 days are up. */
export async function runDueErasures(): Promise<{ due: number; done: number; failed: number }> {
  const admin = createAdminClient()
  if (!admin) return { due: 0, done: 0, failed: 0 }
  const { data } = await admin.from('account_erasures').select(ERASURE_COLS).eq('status', 'scheduled').lte('due_at', new Date().toISOString()).limit(50)
  let done = 0
  let failed = 0
  const now = Date.now()
  const due = ((data ?? []) as Erasure[]).filter((e) => eraseIsDue({ status: e.status, dueAtMs: new Date(e.due_at).getTime() }, now))
  for (const e of due) {
    const r = await runErase(e)
    if (r.ok) done++
    else failed++
  }
  return { due: due.length, done, failed }
}
