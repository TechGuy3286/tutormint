import { llmsText } from '@/lib/siteIdentity'

// /llms.txt — a short plain-text description of TutorMint for language models
// and other readers (owner, 13 Oct 2026). Built from lib/siteIdentity, the same
// source as the page titles and structured data. No personal data.

export const dynamic = 'force-static'

export function GET() {
  return new Response(llmsText(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
