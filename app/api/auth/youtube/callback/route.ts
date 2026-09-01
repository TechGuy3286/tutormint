import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { BRAND, NEUTRAL } from '@/lib/brand'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center; background: ${BRAND.bg};">
          <div style="max-width: 600px; margin: auto; background: white; padding: 30px; border-radius: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: ${BRAND.greenDeep}; margin-top: 0;">🎉 YouTube Authorization Successful!</h2>
            <p style="color: ${NEUTRAL.slate700}; font-size: 14px;">Copy your Refresh Token below and save it into your <b>.env.local</b> and <b>Vercel Environment Variables</b> as <b>YOUTUBE_REFRESH_TOKEN</b>:</p>
            <textarea style="width: 100%; height: 120px; padding: 12px; font-family: monospace; font-size: 12px; border: 1px solid ${NEUTRAL.slate300}; border-radius: 10px; background: ${NEUTRAL.slate100};" readonly>${tokens.refresh_token}</textarea>
          </div>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}