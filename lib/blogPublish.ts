import 'server-only'
import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { PREVIEW_MODE } from '@/lib/preview'
import { absoluteUrl } from '@/lib/siteUrl'
import { postPath } from '@/lib/blog'

// Blog publishing side-effects, in one place: cache revalidation, the
// scheduled-publish sweep, and the (best-effort) search-engine notification.
//
// Kept out of lib/blog.ts because that file is imported by the client editor
// and must not pull in server-only modules.

/**
 * Mark the blog surfaces stale after a change. The index and the post page are
 * dynamic, and the sitemap is on a timer — this makes a publish or unpublish
 * show up immediately rather than at the next revalidation. Wrapped because it
 * is also reachable from the cron, where a path revalidation outside a request
 * is a no-op we do not want to throw.
 */
export function revalidateBlog(slug?: string | null): void {
  try {
    revalidatePath('/blog')
    if (slug) revalidatePath(postPath(slug))
    revalidatePath('/sitemap.xml')
  } catch {
    /* not in a request scope */
  }
}

/**
 * Tell search engines a URL changed — ONLY when preview mode is off, because
 * while the site is noindex we are asking crawlers to stay away, and pinging
 * them would be the opposite signal.
 *
 * Google retired its sitemap-ping endpoint in 2023; submission is now through
 * Search Console (a dashboard/API step done at launch, T8b). What we can do
 * automatically is IndexNow, which Bing and others accept — and only when a key
 * is configured. Best-effort and non-fatal: a publish must never fail because
 * an external ping did.
 */
export async function notifySearchEngines(urls: string[]): Promise<void> {
  if (PREVIEW_MODE || urls.length === 0) return
  const key = process.env.INDEXNOW_KEY
  if (!key) return

  try {
    const host = new URL(absoluteUrl('/')).host
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: absoluteUrl(`/${key}.txt`),
        urlList: urls.map((u) => absoluteUrl(u)),
      }),
    })
  } catch {
    /* the ping is a courtesy, never a blocker */
  }
}

/**
 * Publish every scheduled post whose time has come. Run from the daily
 * subscription cron (the existing sweep). Idempotent: it only touches rows
 * still in 'scheduled', and sets published_at only if it was empty, so a
 * re-run changes nothing.
 */
export async function publishDuePosts(): Promise<{ published: number; slugs: string[]; errors: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { published: 0, slugs: [], errors: ['service-role client unavailable'] }

  const nowIso = new Date().toISOString()
  const { data: due, error } = await admin
    .from('posts')
    .select('id, slug, published_at')
    .eq('status', 'scheduled')
    .lte('publish_at', nowIso)

  if (error) return { published: 0, slugs: [], errors: [error.message] }
  const rows = (due ?? []) as { id: string; slug: string; published_at: string | null }[]
  if (rows.length === 0) return { published: 0, slugs: [], errors: [] }

  const errors: string[] = []
  const slugs: string[] = []
  for (const r of rows) {
    const { error: upd } = await admin
      .from('posts')
      .update({
        status: 'published',
        published_at: r.published_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq('id', r.id)
      .eq('status', 'scheduled') // guard against a race
    if (upd) errors.push(`${r.slug}: ${upd.message}`)
    else slugs.push(r.slug)
  }

  if (slugs.length > 0) {
    revalidateBlog()
    for (const s of slugs) revalidateBlog(s)
    await notifySearchEngines(['/blog', ...slugs.map(postPath)])
  }

  return { published: slugs.length, slugs, errors }
}
