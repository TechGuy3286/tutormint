'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { ctasFor, type PostAudience } from '@/lib/blog'

// The reader CTA at the foot of a post, chosen by the post's audience. No price
// on either — a public page never signals a paywall (the conversion rules).
//
// A click is beaconed to /api/blog/cta-click so the admin list can show which
// posts actually move someone to act, then the navigation proceeds. sendBeacon
// where available so it survives the page change; a keepalive fetch otherwise.

export default function PostCta({ postId, audience }: { postId: string; audience: PostAudience }) {
  const ctas = ctasFor(audience)

  const beacon = () => {
    const body = JSON.stringify({ id: postId })
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/blog/cta-click', new Blob([body], { type: 'application/json' }))
        return
      }
    } catch {
      /* fall through */
    }
    void fetch('/api/blog/cta-click', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  }

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ctas.map((c) => (
        <div key={c.audience} className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-black text-tm-navy">{c.heading}</p>
          <p className="mt-1 text-xs text-gray-500">{c.body}</p>
          <Link
            href={c.href}
            onClick={beacon}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
          >
            {c.label} <ArrowRight aria-hidden size={14} />
          </Link>
        </div>
      ))}
    </section>
  )
}
