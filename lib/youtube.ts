import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Set the permanent refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: 'v3',
  auth: oauth2Client,
});

// The prefix EVERY introduction placeholder carries (owner PR6 §1.3 / PR13 §2.3):
// "TutorMint intro — <short id>", no member name. The cleanup uses it as a guard
// so it only ever removes videos this platform created, never anything else on
// the channel.
export const INTRO_TITLE_PREFIX = 'TutorMint intro'

/**
 * Change a tutor video's privacy on YouTube.
 *
 * The moderation drawer offers this only after a video is approved: reviewing
 * a video is a decision about the tutor, publishing it is a decision about
 * what the public sees, and CLAUDE.md keeps the second one at manager level.
 *
 * DEGRADES GRACEFULLY, like the T3 upload route. With no YOUTUBE_* credentials
 * this returns { success: false, unconfigured: true } instead of throwing, so
 * the caller can still record the intended visibility on tutor_profiles and
 * say plainly that YouTube was not reachable. The alternative -- a 500 -- would
 * make the whole moderation drawer unusable on a machine without the API
 * credentials, which is every developer machine.
 */
export function youtubeConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN,
  )
}

/** The largest introduction video we accept (PR 3b §4.2). YouTube's own limit is
 *  far higher; this is the sane browser-upload ceiling shown to the tutor. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

/**
 * Create a RESUMABLE upload session on the official channel and return its
 * session URL, so the BROWSER can PUT the video bytes straight to Google —
 * bypassing the Vercel serverless request-body cap (~4.5 MB) that made a real
 * introduction video impossible to upload (PR 3b §4.1). The server never sees
 * the bytes; it only mints the session (holding the OAuth token) and, later,
 * records the resulting video id.
 *
 * The session is created PRIVATE, exactly like the old direct insert, so the
 * video stays a draft pending review. Returns { ok, uploadUrl } or a stated
 * failure — never throws.
 */
// The user-facing message for a failed session (owner PR6 §1.5). The technical
// detail (status, reason, body) stays in the server log only — never the "(400)".
const GENERIC_SESSION_ERROR =
  "The video couldn't be uploaded. Please try again, or choose a different video."

// YouTube reasons that mean the UPLOAD ACCOUNT itself is capped or throttled —
// NOT the tutor's video. Retrying or picking another file cannot fix these
// (owner PR6 §1.1: production hit `uploadLimitExceeded`), so the route treats
// them as "temporarily unavailable" rather than telling the tutor to try again.
const ACCOUNT_LIMIT_REASONS = new Set([
  'uploadLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
])

/** Pull YouTube's machine reason out of an error body, or '' — for the log and
 *  the account-limit decision. Never throws. */
function youtubeErrorReason(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { errors?: Array<{ reason?: string }> } }
    return j.error?.errors?.[0]?.reason ?? ''
  } catch {
    return ''
  }
}

export async function createResumableUploadSession({
  title,
  description,
  contentType,
  contentLength,
}: {
  title: string
  description: string
  contentType: string
  contentLength: number
}): Promise<
  | { ok: true; uploadUrl: string }
  | { ok: false; error: string; reason?: string; accountLimit?: boolean }
> {
  if (!youtubeConfigured()) {
    return { ok: false, error: 'YouTube API credentials are not set.' }
  }
  try {
    const { token } = await oauth2Client.getAccessToken()
    if (!token) return { ok: false, error: GENERIC_SESSION_ERROR }

    const res = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          // The eventual media, declared up front so Google sizes the session.
          // The route guarantees a video/* or octet-stream type (owner PR6 §1.3).
          'X-Upload-Content-Type': contentType || 'application/octet-stream',
          // Integer bytes only.
          'X-Upload-Content-Length': String(Math.trunc(contentLength)),
        },
        body: JSON.stringify({
          snippet: {
            title: title || 'Tutor Introduction Video',
            description: description || 'Uploaded via TutorMint for review.',
            categoryId: '27', // Education
          },
          status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
        }),
      },
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const reason = youtubeErrorReason(detail)
      // Log the FULL body + reason on every non-2xx (owner PR6 §1.2). It is
      // YouTube's own error JSON — no tokens (the bearer is only a request
      // header, never echoed) and no personal data (the title carries no name).
      console.error(
        `[video] YouTube resumable session refused: status=${res.status} reason=${reason || 'unknown'} body=${detail.slice(0, 1000)}`,
      )
      return {
        ok: false,
        error: GENERIC_SESSION_ERROR,
        reason,
        accountLimit: ACCOUNT_LIMIT_REASONS.has(reason),
      }
    }
    const uploadUrl = res.headers.get('location')
    if (!uploadUrl) {
      console.error('[video] YouTube resumable session returned no Location header.')
      return { ok: false, error: GENERIC_SESSION_ERROR }
    }
    return { ok: true, uploadUrl }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.error('[video] YouTube resumable session exception:', message)
    return { ok: false, error: GENERIC_SESSION_ERROR }
  }
}

/**
 * Confirm a client-reported video id is a PRIVATE upload on our own channel, so
 * the record step cannot be spoofed with an arbitrary id. A private video is
 * returned by videos.list only to the credentials that own it — you cannot list
 * a private video you do not own by id — so "found AND private" proves it came
 * through our resumable session. Returns { ok } or a stated failure.
 */
export async function verifyOwnUploadedVideo(
  videoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!youtubeConfigured()) return { ok: false, error: 'YouTube API credentials are not set.' }
  try {
    const res = await youtube.videos.list({ part: ['status'], id: [videoId] })
    const item = res.data.items?.[0]
    if (!item) return { ok: false, error: 'That video was not found on the channel.' }
    if (item.status?.privacyStatus !== 'private') {
      return { ok: false, error: 'That video is not a private upload on our channel.' }
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not verify the video.'
    return { ok: false, error: message }
  }
}

export async function setVideoVisibility(
  videoId: string,
  privacyStatus: 'private' | 'unlisted' | 'public',
): Promise<{ success: boolean; unconfigured?: boolean; error?: string }> {
  if (!youtubeConfigured()) {
    return { success: false, unconfigured: true, error: 'YouTube API credentials are not set.' };
  }

  try {
    // videos.update replaces the whole `status` part, so the other status
    // fields have to be sent back with it or they are cleared. Read first.
    const existing = await youtube.videos.list({ part: ['status'], id: [videoId] });
    const current = existing.data.items?.[0]?.status;
    if (!current) return { success: false, error: 'That video was not found on the channel.' };

    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: videoId,
        status: {
          ...current,
          privacyStatus,
        },
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('YouTube visibility error:', error.message);
    return { success: false, error: error.message };
  }
}

/** Delete a video from the channel. Never throws — a failed delete is logged and
 *  reported, so a cleanup pass carries on with the rest. */
export async function deleteVideo(videoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!youtubeConfigured()) return { ok: false, error: 'YouTube API credentials are not set.' }
  try {
    await youtube.videos.delete({ id: videoId })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.error(`[video] delete ${videoId} failed: ${message}`)
    return { ok: false, error: message }
  }
}

type ChannelVideo = {
  id: string
  title: string
  uploadStatus: string | null
  publishedAt: string | null
}

/**
 * Every video on our own channel's uploads playlist, with the fields the cleanup
 * needs. Pages through the playlist. Empty on any error (logged), so a cleanup
 * failure never deletes on incomplete data.
 */
async function listChannelUploads(): Promise<ChannelVideo[]> {
  const ch = await youtube.channels.list({ part: ['contentDetails'], mine: true })
  const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) return []

  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const page = await youtube.playlistItems.list({
      part: ['contentDetails'],
      playlistId: uploads,
      maxResults: 50,
      pageToken,
    })
    for (const it of page.data.items ?? []) {
      const id = it.contentDetails?.videoId
      if (id) ids.push(id)
    }
    pageToken = page.data.nextPageToken ?? undefined
  } while (pageToken)

  const out: ChannelVideo[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const res = await youtube.videos.list({ part: ['snippet', 'status'], id: batch })
    for (const v of res.data.items ?? []) {
      out.push({
        id: v.id ?? '',
        title: v.snippet?.title ?? '',
        uploadStatus: v.status?.uploadStatus ?? null,
        publishedAt: v.snippet?.publishedAt ?? null,
      })
    }
  }
  return out
}

/**
 * Delete abandoned introduction placeholders (owner PR13 §2.2).
 *
 * A tutor's resumable upload that never completes leaves a "processing"
 * placeholder on the channel ("Processing will begin shortly"). This removes
 * every channel video that:
 *   - carries OUR intro title prefix (so nothing else on the channel is touched);
 *   - is NOT pointed at by any tutor record (`keepIds` — tutor_profiles.video_youtube_id);
 *   - AND (for the daily sweep) is older than `olderThanHours`, so a legitimate
 *     upload in progress right now is never caught.
 *
 * A recorded/approved video always has a matching tutor record, so it is kept
 * whatever its YouTube status. Returns what it removed; never throws.
 */
export async function cleanupAbandonedVideos(params: {
  keepIds: Set<string>
  olderThanHours: number
  /** Restrict to titles containing this (a tutor's id prefix) — for the
   *  immediate per-tutor abandon; omitted for the channel-wide daily sweep. */
  titleContains?: string
}): Promise<{ ok: boolean; scanned: number; deleted: string[]; failed: string[]; error?: string }> {
  if (!youtubeConfigured()) {
    return { ok: false, scanned: 0, deleted: [], failed: [], error: 'YouTube API credentials are not set.' }
  }
  try {
    const videos = await listChannelUploads()
    const cutoff = Date.now() - params.olderThanHours * 3600_000
    const deleted: string[] = []
    const failed: string[] = []

    for (const v of videos) {
      if (!v.id) continue
      // Only our own intro placeholders — never anything else on the channel.
      if (!v.title.startsWith(INTRO_TITLE_PREFIX)) continue
      // A tutor record points at it → it is a real, kept video.
      if (params.keepIds.has(v.id)) continue
      // Per-tutor abandon scoping.
      if (params.titleContains && !v.title.includes(params.titleContains)) continue
      // Age guard (0 for the immediate abandon).
      const published = v.publishedAt ? Date.parse(v.publishedAt) : 0
      if (params.olderThanHours > 0 && published && published > cutoff) continue

      const res = await deleteVideo(v.id)
      if (res.ok) deleted.push(v.id)
      else failed.push(v.id)
    }
    return { ok: true, scanned: videos.length, deleted, failed }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.error('[video] cleanupAbandonedVideos failed:', message)
    return { ok: false, scanned: 0, deleted: [], failed: [], error: message }
  }
}
