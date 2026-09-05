import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Clock } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import TimeAgo from '@/components/TimeAgo'
import PostBody from '@/components/blog/PostBody'
import PostCard from '@/components/blog/PostCard'
import Toc from '@/components/blog/Toc'
import ShareButtons from '@/components/blog/ShareButtons'
import PostCta from '@/components/blog/PostCta'
import PostViews from '@/components/blog/PostViews'
import RelatedLanding from '@/components/blog/RelatedLanding'
import { getPublishedPost, relatedPosts } from '@/lib/blogFeed'
import { clusterLabel, postPath, publicBlogUrl } from '@/lib/blog'
import { parseMarkdown, plainText } from '@/lib/markdown'
import { articleJsonLd, jsonLdScript, pageTitle, pageDescription } from '@/lib/seo'
import { absoluteUrl } from '@/lib/siteUrl'
import { getCompany } from '@/lib/company'

// /blog/[slug] — one post, server-rendered.
//
// A slug that is not a published post 404s through a friendly branded page
// (see not-found.tsx). An UNPUBLISHED post ideally answers 410 Gone, but Next
// 16's page-level status interrupts stop at 404, and the row is invisible to
// edge middleware under RLS — so a branded 404 with a link to /blog is the
// honest best this stack allows. The sitemap drops the URL on unpublish, which
// is the signal a crawler actually acts on.

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) return { title: pageTitle('Blog'), robots: { index: false, follow: true } }

  const desc =
    (post.seoDescription ?? '').trim() || plainText(post.body).slice(0, 155) || post.title
  const canonical = postPath(post.slug)
  const image = post.coverPath ? publicBlogUrl(post.coverPath) : absoluteUrl('/tutormint-logo1200x630.png')

  return {
    title: (post.seoTitle ?? '').trim() || pageTitle(post.title),
    description: desc,
    alternates: { canonical },
    openGraph: {
      title: post.seoTitle ?? post.title,
      description: desc,
      url: absoluteUrl(canonical),
      type: 'article',
      images: [{ url: image }],
      locale: post.language === 'ur' ? 'ur_PK' : 'en_PK',
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
    },
    twitter: { card: 'summary_large_image', title: post.seoTitle ?? post.title, description: desc, images: [image] },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) notFound()

  const { segments, headings, readingTime } = parseMarkdown(post.body)
  const [company, related] = await Promise.all([
    getCompany(),
    relatedPosts({ cluster: post.cluster, excludeId: post.id, limit: 3 }),
  ])

  const url = absoluteUrl(postPath(post.slug))
  const cover = post.coverPath ? publicBlogUrl(post.coverPath) : null
  const isUrdu = post.language === 'ur'

  const jsonLd = articleJsonLd({
    url,
    title: post.title,
    description: (post.seoDescription ?? '').trim() || plainText(post.body).slice(0, 155),
    image: cover ?? absoluteUrl('/tutormint-logo1200x630.png'),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    language: post.language,
    legalName: company.legalName,
    section: clusterLabel(post.cluster),
    subject: post.subject,
    city: post.city,
  })

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(jsonLd)} />
      <PostViews postId={post.id} />

      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs
          items={[{ label: 'Blog', href: '/blog' }, { label: post.title }]}
        />

        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[11px] font-bold text-tm-navy">
              {clusterLabel(post.cluster)}
            </span>
            {isUrdu && (
              <span className="rounded-full bg-tm-tint-green px-2 py-0.5 text-[11px] font-bold text-tm-green-deep">
                اردو
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">{post.title}</h1>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden size={13} /> {readingTime} min read
            </span>
            {post.publishedAt && <TimeAgo iso={post.publishedAt} />}
          </div>
        </header>

        {cover && (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt={post.coverAlt ?? ''}
              className="max-h-[420px] w-full object-cover"
            />
          </div>
        )}

        <div className="gap-8 lg:grid lg:grid-cols-[240px_1fr]">
          {/* Sidebar: TOC + related directory pages. Sticky on desktop; stacks
              above the body on mobile. */}
          <aside className="mb-4 space-y-4 lg:mb-0 lg:sticky lg:top-20 lg:self-start">
            <Toc headings={headings} />
            <RelatedLanding paths={post.relatedLandingPages} />
          </aside>

          <div className="min-w-0 space-y-6">
            <article lang={post.language} dir={isUrdu ? 'rtl' : undefined}>
              <PostBody segments={segments} />
            </article>

            <ShareButtons url={url} title={post.title} />
            <PostCta postId={post.id} audience={post.audience} />

            {related.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-black text-tm-navy">Related reading</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {related.map((p) => (
                    <PostCard key={p.id} post={p} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
