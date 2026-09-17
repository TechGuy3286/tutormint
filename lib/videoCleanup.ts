import { createAdminClient } from '@/lib/supabase/admin'
import { cleanupAbandonedVideos, youtubeConfigured } from '@/lib/youtube'

// Delete abandoned YouTube introduction placeholders (owner PR13 §2.2).
//
// "keep" is every video id a tutor record points at — a real, recorded (or
// approved) video — so the cleanup only ever removes placeholders that belong to
// no tutor. Read through the service role: tutor_profiles is not the caller's to
// read in full, and this is a background job.

async function keptVideoIds(): Promise<Set<string>> {
  const admin = createAdminClient()
  if (!admin) return new Set()
  const { data } = await admin.from('tutor_profiles').select('video_youtube_id')
  const ids = new Set<string>()
  for (const r of data ?? []) {
    const id = r.video_youtube_id as string | null
    if (id) ids.add(id)
  }
  return ids
}

/**
 * The daily sweep: delete our intro placeholders older than 24h that no tutor
 * record points at. The age guard means a live upload is never caught.
 */
export async function sweepAbandonedVideos(): Promise<{
  ok: boolean
  scanned: number
  deleted: number
  failed: number
  error?: string
}> {
  if (!youtubeConfigured()) return { ok: false, scanned: 0, deleted: 0, failed: 0, error: 'unconfigured' }
  const keepIds = await keptVideoIds()
  const res = await cleanupAbandonedVideos({ keepIds, olderThanHours: 24 })
  return { ok: res.ok, scanned: res.scanned, deleted: res.deleted.length, failed: res.failed.length, error: res.error }
}

/**
 * The immediate per-tutor abandon: delete THIS tutor's own intro placeholder(s)
 * that no record points at, regardless of age (they just abandoned the upload).
 * Scoped to the tutor's own id prefix, so it can only touch their own leftovers.
 */
export async function abandonTutorVideo(tutorId: string): Promise<{ ok: boolean; deleted: number }> {
  if (!youtubeConfigured()) return { ok: false, deleted: 0 }
  const keepIds = await keptVideoIds()
  const res = await cleanupAbandonedVideos({
    keepIds,
    olderThanHours: 0,
    titleContains: tutorId.slice(0, 8),
  })
  return { ok: res.ok, deleted: res.deleted.length }
}
