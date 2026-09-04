import Link from 'next/link'
import { Newspaper } from 'lucide-react'

// The friendly page for a blog URL that is not a published post — either it
// never existed, or it was unpublished. Never blank, and it always offers the
// way on to /blog. Returned as 404 (Next's page interrupts stop at 404); the
// URL leaves the sitemap on unpublish, which is what a crawler acts on.

export default function BlogPostNotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center bg-tm-bg px-4 py-10">
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-tm-tint-navy">
          <Newspaper aria-hidden className="text-tm-navy" size={22} />
        </div>
        <h1 className="text-lg font-black text-tm-navy">This post isn’t available</h1>
        <p className="text-sm text-gray-600">
          It may have been unpublished, or the link may be out of date. The rest of our guides are
          still here.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Link
            href="/blog"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
          >
            Read the blog
          </Link>
          <Link
            href="/browse/tutors"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            Browse tutors
          </Link>
        </div>
      </div>
    </main>
  )
}
