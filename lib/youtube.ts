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