import { listPublishedPosts } from '@/lib/blogFeed'
import { clusterLabel, postPath } from '@/lib/blog'
import { absoluteUrl, SITE_URL } from '@/lib/siteUrl'
import { BRAND } from '@/lib/seo'

// /blog/feed.xml — RSS 2.0 of the most recent published posts.
//
// Server-rendered on demand and cached briefly. Everything user-supplied is
// XML-escaped; guids are the permanent post URLs.

export const dynamic = 'force-dynamic'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const { items } = await listPublishedPosts({ limit: 50 })
  const self = `${SITE_URL}/blog/feed.xml`

  const entries = items
    .map((p) => {
      const link = absoluteUrl(postPath(p.slug))
      const pubDate = p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString()
      return `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      <category>${xmlEscape(clusterLabel(p.cluster))}</category>
      <pubDate>${pubDate}</pubDate>
      <description>${xmlEscape(p.excerpt)}</description>
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(BRAND)} Blog</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
    <description>Guides for parents and tutors in Pakistan — costs, boards, subjects and safe hiring.</description>
    <language>en-pk</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=1800',
    },
  })
}
