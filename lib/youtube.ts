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
