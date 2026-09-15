import { google } from 'googleapis';
import fs from 'fs';

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

export async function uploadVideoToDrafts({
  filePath,
  title,
  description,
}: {
  filePath: string;
  title: string;
  description: string;
}) {
  try {
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title || 'Tutor Introduction Video',
          description: description || 'Uploaded securely via TutorMint platform for review.',
          categoryId: '27', // Education category ID
        },
        status: {
          privacyStatus: 'private', // Keeps it hidden as a Draft in YouTube Studio!
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    return {
      success: true,
      videoId: response.data.id,
      videoUrl: `https://www.youtube.com/watch?v=${response.data.id}`,
    };
  } catch (error: any) {
    console.error('YouTube Upload Error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}
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
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  if (!youtubeConfigured()) {
    return { ok: false, error: 'YouTube API credentials are not set.' }
  }
  try {
    const { token } = await oauth2Client.getAccessToken()
    if (!token) return { ok: false, error: 'Could not authenticate with YouTube.' }

    const res = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          // The eventual media, declared up front so Google sizes the session.
          'X-Upload-Content-Type': contentType || 'video/*',
          'X-Upload-Content-Length': String(contentLength),
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
      console.error('YouTube resumable session error:', res.status, detail.slice(0, 300))
      return { ok: false, error: `YouTube refused the upload session (${res.status}).` }
    }
    const uploadUrl = res.headers.get('location')
    if (!uploadUrl) return { ok: false, error: 'YouTube did not return an upload URL.' }
    return { ok: true, uploadUrl }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start the upload.'
    console.error('YouTube resumable session exception:', message)
    return { ok: false, error: message }
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
