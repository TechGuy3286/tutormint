import type { Metadata } from 'next'
import { BlogIndexView, blogIndexMetadata, type BlogSearch } from '../../blog/BlogIndex'

// The query twin of /blog (push 3, owner 1 Nov 2026). proxy.ts rewrites
// /blog?cluster=… and /blog?page=… here, so the clean /blog can be cached; the
// visitor's address bar still reads /blog?… and the canonical is /blog.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }: { searchParams: Promise<BlogSearch> }): Promise<Metadata> {
  return blogIndexMetadata(await searchParams)
}

export default async function BlogQueryPage({ searchParams }: { searchParams: Promise<BlogSearch> }) {
  return <BlogIndexView sp={await searchParams} />
}
