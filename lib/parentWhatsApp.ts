// lib/parentWhatsApp.ts — the ONE way a staff member messages a parent
// (owner, 27 Oct 2026). Follow-ups → Parents, the parent's admin page, People,
// Overview cards and the tuition admin page all come here, so every parent
// WhatsApp works the way the tutors' does:
//
//   • the message is picked by the parent's situation (lib/parentFollowUpCore
//     parentMessageSituation) from Team inbox → Templates → Parents;
//   • it always carries a TutorMint link, with the sender's ?ref code;
//   • the link is the shared builder's (lib/waLinkCore waSendHref);
//   • each send is recorded as a follow-up (source 'parents'), with the same
//     10-second Undo, 3-day wait and 3-message rules as tutors.
//
// With no WhatsApp number but an email, the message goes as an official in-app
// message + email instead. Never logs a number or an address.

import { POST_TUITION_PUBLIC_PATH } from '@/lib/postTuitionPage'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { recordFollowUp } from '@/lib/followUps'
import { sendAdminMessage } from '@/lib/adminMessaging'
import { parentForSend } from '@/lib/parentFollowUps'
import { fillParentFollowUp, PARENT_DEFAULTS, PARENT_PLACEHOLDERS } from '@/lib/parentFollowUpCore'
import { unknownPlaceholders } from '@/lib/applicationTemplatesCore'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { senderRefCode } from '@/lib/staffSignups'
import { finishWaText, siteLink, waSendHref } from '@/lib/waLinkCore'
import { formatName } from '@/lib/formatName'
import type { AdminActor } from '@/lib/adminAuth'

/** At most this many tutor profiles go in a "Tutors applied" message. */
export const MAX_TUTOR_LINKS = 5

/** The public profile links of the real tutors who applied to a tuition. */
async function tutorLinksFor(admin: NonNullable<ReturnType<typeof createAdminClient>>, jobId: string): Promise<string[]> {
  const { data: apps } = await admin
    .from('applications')
    .select('tutor_id, stage, status, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  const live = ((apps ?? []) as { tutor_id: string; stage: string | null; status: string | null }[]).filter(
    (a) => a.status !== 'withdrawn' && a.stage !== 'not_selected' && a.stage !== 'no_response',
  )
  const ids = [...new Set(live.map((a) => a.tutor_id))]
  if (ids.length === 0) return []
  // Only listed tutors (tutor_directory): their profile pages render publicly.
  const { data } = await admin.from('tutor_directory').select('id, slug').in('id', ids)
  const slugBy = new Map(((data ?? []) as { id: string; slug: string | null }[]).map((t) => [t.id, t.slug]))
  return ids
    .map((id) => slugBy.get(id))
    .filter((s): s is string => !!s)
    .slice(0, MAX_TUTOR_LINKS)
    .map((slug) => siteLink(`/tutor/${slug}`))
}

export type ParentSend =
  | { ok: true; id: string; waHref: string | null; emailed: boolean; reason: string; templateKey: string }
  | { ok: false; status: number; error: string }

/** Build the parent's situation message, record the follow-up, return the WhatsApp link. */
export async function sendParentMessage(memberId: string, actor: AdminActor): Promise<ParentSend> {
  const target = await parentForSend(memberId)
  if (!target) return { ok: false, status: 404, error: 'This parent has nothing to follow up right now.' }
  const { row } = target
  if (!row.templateKey) return { ok: false, status: 400, error: 'There is no message for this parent right now.' }
  if (!target.phone && !target.email) return { ok: false, status: 400, error: 'This parent has no WhatsApp number or email.' }

  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const [{ data: tpl }, support, refCode] = await Promise.all([
    admin.from('admin_message_templates').select('body').eq('key', row.templateKey).maybeSingle(),
    loadSupportWhatsApp(admin),
    senderRefCode(actor.id),
  ])
  // A stored body that is empty or has an unknown placeholder is never sent — the default is.
  const stored = ((tpl?.body as string | null) ?? '').trim()
  const body = stored && unknownPlaceholders(stored, PARENT_PLACEHOLDERS).length === 0 ? stored : PARENT_DEFAULTS[row.templateKey]
  const tuition = target.facts.tuitions.find((t) => t.id === row.tuition?.id)
  const tutorLinks = row.reason === 'waiting_forward' && row.tuition ? await tutorLinksFor(admin, row.tuition.id) : []
  const text = fillParentFollowUp(body, {
    firstName: formatName(row.name).split(' ')[0] ?? '',
    tuitionTitle: row.tuition?.title ?? null,
    tuitionLink: row.tuition?.path ? siteLink(row.tuition.path) : null,
    // The public "Post your tuition" page (owner, 28 Oct 2026): never a sign-in or dashboard address.
    postLink: siteLink(POST_TUITION_PUBLIC_PATH),
    tutorName: tuition?.hiredTutorName ?? null,
    reviewLink: tuition?.hiredApplicationId ? siteLink(`/review?application=${tuition.hiredApplicationId}`) : siteLink('/review'),
    // No tutor with a public profile yet: their tuition page, so the message still has a link.
    tutorLinks: tutorLinks.length > 0 ? tutorLinks : row.tuition?.path ? [siteLink(row.tuition.path)] : [siteLink('/browse/tutors')],
    signinLink: siteLink('/login'),
    repostLink: row.tuition ? siteLink(`/parent/dashboard/job/${row.tuition.id}`) : siteLink('/parent/dashboard/post-job'),
    supportWhatsapp: support,
  })

  let waHref: string | null = null
  if (target.phone) {
    waHref = waSendHref(target.phone, finishWaText(text, refCode), refCode)
  } else {
    const sent = await sendAdminMessage({ memberId, body: text, templateKey: row.templateKey, channel: 'inapp', actor })
    if (!sent.ok) return { ok: false, status: sent.status, error: sent.error }
  }
  const res = await recordFollowUp({
    memberId,
    channel: target.phone ? 'whatsapp' : 'email',
    templateKey: row.templateKey,
    source: 'parents',
    reason: row.reason,
    progress: row.progress,
    actor,
  })
  if (!res.ok) return { ok: false, status: res.status, error: res.error }
  return { ok: true, id: res.id, waHref, emailed: !target.phone, reason: row.reason, templateKey: row.templateKey }
}
