import { NextRequest, NextResponse } from 'next/server';
import { uploadVideoToDrafts } from '@/lib/youtube';
import fs from 'fs';
import os from 'os';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('video') as File;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No video file provided' }, { status: 400 });
    }

    // Save temporary file locally to stream to YouTube API
    const buffer = Buffer.from(await file.arrayBuffer());
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${file.name}`);
    fs.writeFileSync(tempFilePath, buffer);

    // Upload to YouTube as Private Draft
    const result = await uploadVideoToDrafts({
      filePath: tempFilePath,
      title,
      description,
    });

    // Cleanup temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    if (result.success) {
      return NextResponse.json({ success: true, videoUrl: result.videoUrl });
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}