import Link from 'next/link'
import { AlertTriangle, Plus } from 'lucide-react'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import BlogAdminList from '@/components/admin/blog/BlogAdminList'
import { listAdminPosts } from '@/lib/blogFeed'
import { createAdminClient } from '@/lib/supabase/admin'
import { POST_CLUSTERS } from '@/lib/blog'
import { cadenceWarning, postsInWeek } from '@/lib/blogApproval'

// /admin/blog — every post, drafts included. Manager or support (support
// drafts, manager publishes). The list itself re-checks in its API route.

export const dynamic = 'force-dynamic'

/** Published this week, the cadence warning, and published posts per cluster
 *  (owner, 5 Oct 2026). Read through the service role: this is an admin screen. */
async function blogStats() {
  const admin = createAdminClient()
  const empty = { publishedThisWeek: 0, inWeek: 0, warning: null as string | null, perCluster: POST_CLUSTERS.map((c) => ({ ...c, count: 0 })) }
  if (!admin) return empty
  const { data } = await admin.from('posts').select('status, cluster, published_at, publish_at')
  const rows = ((data ?? []) as { status: string; cluster: string; published_at: string | null; publish_at: string | null }[]).map((r) => ({
    status: r.status,
    cluster: r.cluster,
    publishedAt: r.published_at,
    publishAt: r.publish_at,
  }))
  const now = new Date()
  const publishedThisWeek = postsInWeek(rows.filter((r) => r.status === 'published'), now)
  const inWeek = postsInWeek(rows, now)
  const perCluster = POST_CLUSTERS.map((c) => ({
    ...c,
    count: rows.filter((r) => r.status === 'published' && r.cluster === c.slug).length,
  }))
  return { publishedThisWeek, inWeek, warning: cadenceWarning(inWeek), perCluster }
}

export default async function AdminBlogPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blog)
  const [{ items, nextCursor }, stats] = await Promise.all([listAdminPosts({ limit: 20 }), blogStats()])
  const canPublish = roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Blog</h1>
          <p className="text-xs text-gray-500">
            {canPublish
              ? 'Write, review and publish guides for parents and tutors.'
              : 'Write and save drafts. A manager reviews and publishes them.'}
          </p>
        </div>
        <Link
          href="/admin/blog/new"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          <Plus aria-hidden size={14} /> New post
        </Link>
      </header>

      {/* Cadence (owner, 5 Oct 2026): published this week, and a WARNING — never
          a block — when a third post is published or scheduled in the same
          Pakistan-time week. */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-xs font-bold text-tm-navy">
          Published this week: <span className="text-base font-black">{stats.publishedThisWeek}</span>
          {stats.inWeek !== stats.publishedThisWeek && (
            <span className="ml-1 font-semibold text-gray-500">({stats.inWeek - stats.publishedThisWeek} more scheduled)</span>
          )}
        </p>
        {stats.warning && (
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-tm-tint-gold px-2.5 py-1 text-[11px] font-bold text-tm-gold-ink">
            <AlertTriangle aria-hidden size={13} /> {stats.warning}
          </p>
        )}
      </section>

      <BlogAdminList initialItems={items} initialCursor={nextCursor} />

      {/* Cluster balance (owner, 5 Oct 2026): published posts per cluster, as a
          plain list — no targets, nothing enforced. */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Published posts per cluster</h2>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          {stats.perCluster.map((c) => (
            <li key={c.slug} className="flex items-baseline justify-between gap-2 border-b border-gray-100 py-1">
              <span className="text-gray-600">{c.label}</span>
              <span className="font-black text-tm-navy">{c.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
