'use client'

import { useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'

// Share a post: WhatsApp, Facebook, X, and copy-link.
//
// WhatsApp first — it is how a link actually travels in Pakistan. Copy-link
// falls back to a hidden input + execCommand when the Clipboard API is
// unavailable (older mobile browsers, non-secure contexts), so the button is
// never a dead end.

export default function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)

  const share = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      const el = document.createElement('input')
      el.value = url
      document.body.appendChild(el)
      el.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      } catch {
        /* nothing more we can do; the URL is in the address bar */
      }
      el.remove()
    }
  }

  const text = encodeURIComponent(title)
  const u = encodeURIComponent(url)

  const btn =
    'inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Share</span>
      <button type="button" onClick={() => share(`https://wa.me/?text=${text}%20${u}`)} className={btn}>
        <MessageCircle aria-hidden size={14} /> WhatsApp
      </button>
      <button
        type="button"
        onClick={() => share(`https://www.facebook.com/sharer/sharer.php?u=${u}`)}
        className={btn}
      >
        <span aria-hidden className="font-black">
          f
        </span>{' '}
        Facebook
      </button>
      <button
        type="button"
        onClick={() => share(`https://twitter.com/intent/tweet?text=${text}&url=${u}`)}
        className={btn}
        aria-label="Share on X"
      >
        <span aria-hidden className="font-black">
          𝕏
        </span>
        Post
      </button>
      <button type="button" onClick={copy} className={btn} aria-label="Copy link">
        {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
