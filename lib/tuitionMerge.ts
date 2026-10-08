// lib/tuitionMerge.ts
//
// Merge a repeat tuition into its survivor, and Refresh a tuition (owner,
// 6 Oct 2026, items 15–16). Server-only; service role; every call is audited.
//
// MERGE does item 15's steps, in order, and nothing else:
//   repeat   → status closed, merged_into = survivor, merged_at, closed_at;
//              301 at /tuitions/<city>/<slug> (the page reads merged_into);
//              out of Browse and the sitemap by status; Indexing API URL_DELETED
//   survivor → one refresh: fresh 7-day clock (resumed_at), top of Browse
//              (bumped_at), Indexing API URL_UPDATED
// Nothing is deleted. A repeat with applications is NOT merged (skipped).
//
// REFRESH moves an open/paused-and-open tuition to the top of Browse with a
// fresh 7 days, same URL, Indexing API URL_UPDATED — at most once every 3 days.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { queueIndexingDelete, queueIndexingUpdate } from '@/lib/googleIndexing'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { refreshAllowed } from './duplicatesCore'
import type { AdminRole } from '@/lib/adminAccessCore'

export type Actor = { id: string; adminRole?: AdminRole | null; email?: string | null; kind: 'admin' | 'parent' | 'script' }

export type MergeResult =
  | { ok: true; repeatRef: string | null; survivorRef: string | null }
  | { ok: false; status: number; error: string }

export async function mergeTuition(repeatId: string, survivorId: string, actor: Actor, why: string): Promise<MergeResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }
  if (repeatId === survivorId) return { ok: false, status: 400, error: 'A tuition cannot be merged into itself.' }

  const { data: rows } = await admin
    .from('jobs')
    .select('id, ref_id, title, status, public_slug, city, parent_id, merged_into')
    .in('id', [repeatId, survivorId])
  const repeat = rows?.find((r) => r.id === repeatId)
  const survivor = rows?.find((r) => r.id === survivorId)
  if (!repeat || !survivor) return { ok: false, status: 404, error: 'Tuition not found.' }
  if (survivor.merged_into) return { ok: false, status: 400, error: 'The survivor was itself merged into another tuition.' }
  if (repeat.merged_into) return { ok: false, status: 400, error: 'That tuition is already merged.' }

  const { count: apps } = await admin.from('applications').select('id', { count: 'exact', head: true }).eq('job_id', repeatId)
  if ((apps ?? 0) > 0) {
    return { ok: false, status: 409, error: `Not merged: ${repeat.ref_id ?? 'this tuition'} has ${apps} application${apps === 1 ? '' : 's'}. Close it by hand if that is right.` }
  }

  const nowIso = new Date().toISOString()
  const { error: e1 } = await admin
    .from('jobs')
    .update({ status: 'closed', closed_at: nowIso, merged_into: survivorId, merged_at: nowIso })
    .eq('id', repeatId)
  if (e1) return { ok: false, status: 500, error: e1.message }

  // The survivor's one refresh. If it was paused it comes back open (the point
  // of a merge is one live page for the family of posts).
  const { error: e2 } = await admin
    .from('jobs')
    .update({ status: survivor.status === 'paused' ? 'open' : survivor.status, resumed_at: nowIso, paused_at: null, bumped_at: nowIso, refreshed_at: nowIso })
    .eq('id', survivorId)
  if (e2) return { ok: false, status: 500, error: e2.message }

  queueIndexingDelete({ public_slug: repeat.public_slug as string | null, city: repeat.city as string | null })
  queueIndexingUpdate({ public_slug: survivor.public_slug as string | null, city: survivor.city as string | null })
  revalidateLanding()

  await logAdminAction({
    actorId: actor.id,
    actorRole: (actor.adminRole ?? 'owner') as AdminRole,
    actorEmail: actor.email ?? null,
    action: 'job.merge',
    targetType: 'job',
    targetId: repeatId,
    detail: {
      repeatRef: repeat.ref_id ?? null,
      survivorId,
      survivorRef: survivor.ref_id ?? null,
      why,
      by: actor.kind,
      repeatTitle: repeat.title,
      survivorTitle: survivor.title,
    },
  })
  return { ok: true, repeatRef: (repeat.ref_id as string) ?? null, survivorRef: (survivor.ref_id as string) ?? null }
}

export type RefreshResult = { ok: true } | { ok: false; status: number; error: string; nextAt?: string }

/** Refresh (item 16). `parentId` scopes a parent to their own tuition; an admin passes null. */
export async function refreshTuition(jobId: string, actor: Actor, parentId: string | null): Promise<RefreshResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }
  const { data: job } = await admin
    .from('jobs')
    .select('id, ref_id, title, status, public_slug, city, parent_id, refreshed_at, merged_into')
    .eq('id', jobId)
    .maybeSingle()
  if (!job || (parentId && job.parent_id !== parentId)) return { ok: false, status: 404, error: 'Tuition not found.' }
  if (job.merged_into) return { ok: false, status: 400, error: 'This tuition was merged into another one and cannot be refreshed.' }
  if (job.status !== 'open' && job.status !== 'paused') {
    return { ok: false, status: 400, error: 'Only an open or paused tuition can be refreshed.\nصرف کھلی یا روکی ہوئی ٹیوشن ریفریش ہو سکتی ہے۔' }
  }
  const allowed = refreshAllowed(job.refreshed_at as string | null)
  if (!allowed.ok) {
    const when = new Date(allowed.nextAt as number)
    return {
      ok: false,
      status: 429,
      error: `This tuition was refreshed recently. You can refresh it again on ${when.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })}.\nیہ ٹیوشن حال ہی میں ریفریش ہوئی ہے۔ ہر 3 دن میں ایک بار ریفریش ہو سکتی ہے۔`,
      nextAt: when.toISOString(),
    }
  }
  const nowIso = new Date().toISOString()
  const { error } = await admin
    .from('jobs')
    .update({ status: 'open', resumed_at: nowIso, paused_at: null, bumped_at: nowIso, refreshed_at: nowIso })
    .eq('id', jobId)
  if (error) return { ok: false, status: 500, error: error.message }
  queueIndexingUpdate({ public_slug: job.public_slug as string | null, city: job.city as string | null })
  revalidateLanding()
  if (actor.kind === 'admin') {
    await logAdminAction({
      actorId: actor.id,
      actorRole: (actor.adminRole ?? 'owner') as AdminRole,
      actorEmail: actor.email ?? null,
      action: 'job.refresh',
      targetType: 'job',
      targetId: jobId,
      detail: { jobRef: job.ref_id ?? null, title: job.title, previousStatus: job.status },
    })
  }
  return { ok: true }
}
