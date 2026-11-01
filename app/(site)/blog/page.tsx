import type { Metadata } from 'next'
import { BlogIndexView, blogIndexMetadata } from './BlogIndex'

// /blog with no query string, cached for everyone (push 3, owner 1 Nov 2026).
// ?cluster= and ?page= are sent to the twin /qs/blog by proxy.ts, so this page
// never reads the query. Rebuilt when a post is published or unpublished
// (revalidatePath in lib/blogPublish) and at most every 10 minutes.
export const revalidate = 600

export const metadata: Metadata = blogIndexMetadata({})

export default function BlogIndexPage() {
  return <BlogIndexView sp={{}} />
}
