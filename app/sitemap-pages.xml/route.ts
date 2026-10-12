import { sitemapEntries } from '@/lib/sitemaps'
import { urlsetXml } from '@/lib/sitemapCore'

// /sitemap-pages.xml — one of the four files /sitemap.xml lists (owner, 12 Oct
// 2026). Read live on every fetch; the rules are in lib/sitemapCore.

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(urlsetXml(await sitemapEntries('pages')), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=600' },
  })
}
