import { SITE_URL } from '@/lib/siteUrl'
import { SITEMAP_FILES, sitemapIndexXml } from '@/lib/sitemapCore'

// /sitemap.xml — the sitemap INDEX (owner, 12 Oct 2026). It lists the four
// files: tuitions (open only), tutors (indexable profiles only), pages (static
// pages and the hubs that clear their rule) and blog. The address Search
// Console and robots.txt already know keeps working; it now points at the four.
//
// The host is www (lib/siteUrl) — the apex redirects there, and a sitemap of
// apex addresses would be a list of redirects.

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(sitemapIndexXml(SITE_URL, SITEMAP_FILES.map((file) => ({ file }))), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=600' },
  })
}
