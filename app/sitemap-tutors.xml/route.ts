import { sitemapEntries } from '@/lib/sitemaps'
import { urlsetXml } from '@/lib/sitemapCore'

// /sitemap-tutors.xml — one of the four files /sitemap.xml lists (owner, 12 Oct
// 2026). Read live on every fetch; the rules are in lib/sitemapCore.

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(urlsetXml(await sitemapEntries('tutors')), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  })
}
