import Link from 'next/link'
import { Eye, ExternalLink } from 'lucide-react'

// The tutor's own view of their public profile (owner PR12 §3).
//
// LISTED: a plain "View your public profile" link to /tutor/[slug] — the page
// parents see. NOT LISTED: the page is not live to anyone yet, so it says so and
// offers a PREVIEW that only the tutor can open (the /tutor/[slug] route renders
// an owner-only preview when the profile is not in the public views), clearly
// marked so nobody mistakes it for a live page.
export default function PublicPageStatus({
  slug,
  listed,
}: {
  slug: string | null
  listed: boolean
}) {
  if (!slug) return null
  const href = `/tutor/${slug}`

  if (listed) {
    return (
      <Link
        href={href}
        className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-bold text-tm-navy hover:underline"
      >
        <ExternalLink size={13} aria-hidden />
        View your public profile
      </Link>
    )
  }

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-bold text-tm-navy">Your public page goes live once you&rsquo;re listed.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy hover:border-tm-navy"
        >
          <Eye size={13} aria-hidden />
          Preview your public page
        </Link>
        <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">
          Preview — not visible to parents
        </span>
      </div>
    </div>
  )
}
