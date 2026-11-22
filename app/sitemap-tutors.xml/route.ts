import { CACHE_SITEMAP } from '@/lib/publicCacheCore'
import { sitemapEntries } from '@/lib/sitemaps'
import { urlsetXml } from '@/lib/sitemapCore'

// /sitemap-tutors.xml — one of the four files /sitemap.xml lists (owner, 12 Oct
// 2026). Built live, then kept at the CDN for up to an hour
// (PR-15, lib/publicCacheCore CACHE_SITEMAP); the rules are in lib/sitemapCore.

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(urlsetXml(await sitemapEntries('tutors')), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': CACHE_SITEMAP },
  })
}
