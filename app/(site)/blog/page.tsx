import type { Metadata } from 'next'
import Link from 'next/link'

import Breadcrumbs from '@/components/Breadcrumbs'
import PostCard from '@/components/blog/PostCard'
import MorePosts from '@/components/blog/MorePosts'
import { listPublishedPosts } from '@/lib/blogFeed'
import { POST_CLUSTERS, isClusterSlug, clusterLabel } from '@/lib/blog'
import { pageTitle, pageDescription } from '@/lib/seo'
import { absoluteUrl } from '@/lib/siteUrl'

// /blog — the index. Server-rendered first window (organic-search surface),
// cluster filters as links (a filtered index is its own crawlable URL), and
// infinite scroll for the rest.
//
// Withdrawn since 3 Sep for want of real content; restored here now the CMS
// gives it real rows. Preview mode still keeps the whole site noindex — the
// global robots flag covers this page like every other.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 9

type SearchParams = { cluster?: string; page?: string }

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const { cluster } = await searchParams
  const validCluster = cluster && isClusterSlug(cluster) ? cluster : null
  const name = validCluster ? `${clusterLabel(validCluster)} — TutorMint Blog` : 'TutorMint Blog'
  const canonical = validCluster ? `/blog?cluster=${validCluster}` : '/blog'
  return {
    title: pageTitle(validCluster ? clusterLabel(validCluster) : 'Blog'),
    description: pageDescription(
      validCluster
        ? `${clusterLabel(validCluster)} guides for parents and tutors`
        : 'Guides on tuition costs, boards and exams, subjects and safe hiring',
    ),
    alternates: { canonical },
    openGraph: { title: name, url: absoluteUrl(canonical), type: 'website' },
  }
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const cluster = sp.cluster && isClusterSlug(sp.cluster) ? sp.cluster : null
  const page = Math.max(1, Number(sp.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const { items, total, nextCursor } = await listPublishedPosts({
    cluster,
    limit: PAGE_SIZE,
    offset,
  })

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <Breadcrumbs items={[{ label: 'Blog' }]} />

        <header className="space-y-2">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">TutorMint Blog</h1>
          <p className="max-w-3xl text-xs leading-relaxed text-gray-600 sm:text-sm">
            Practical guides for parents and tutors in Pakistan — what tuition costs, how the boards
            and exams work, choosing a subject, and hiring safely.
          </p>
        </header>

        {/* Cluster filters, as links: each is its own crawlable URL. */}
        <nav aria-label="Topics" className="flex flex-wrap gap-2">
          <ClusterChip href="/blog" label="All" active={!cluster} />
          {POST_CLUSTERS.map((c) => (
            <ClusterChip
              key={c.slug}
              href={`/blog?cluster=${c.slug}`}
              label={c.label}
              active={cluster === c.slug}
            />
          ))}
        </nav>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-bold text-tm-navy">
              {cluster ? `Nothing in ${clusterLabel(cluster)} yet.` : 'No posts yet.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {cluster ? (
                <Link href="/blog" className="font-semibold text-tm-red hover:underline">
                  See all posts
                </Link>
              ) : (
                'New guides are on the way.'
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
            <MorePosts
              params={cluster ? { cluster } : {}}
              initialCursor={nextCursor}
              total={total}
            />
          </>
        )}
      </div>
    </main>
  )
}

function ClusterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-[11px] font-bold transition-colors ${
        active
          ? 'border-tm-navy bg-tm-navy text-white'
          : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
      }`}
    >
      {label}
    </Link>
  )
}
