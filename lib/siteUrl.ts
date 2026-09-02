// lib/siteUrl.ts
//
// The site's own origin, in one place.
//
// It has to be one place because three things must agree or they quietly
// undermine each other: the metadataBase that builds canonical and Open Graph
// URLs, the absolute URLs in BreadcrumbList JSON-LD, and the links in outgoing
// email. A BreadcrumbList whose item URLs sit on a different host from the
// page's own canonical is not read as that page's breadcrumb trail at all.
//
// www, not the apex. next.config.ts permanently redirects tutormint.org to
// www.tutormint.org, so the apex is never the canonical form of anything --
// lib/notify/templates.ts defaulted to it and sent every link in every email
// through a redirect hop.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.tutormint.org').replace(
  /\/+$/,
  '',
)

/** A site-relative path as an absolute URL. Anything already absolute is returned as is. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
