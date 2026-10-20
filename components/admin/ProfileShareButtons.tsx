'use client'

import { useState } from 'react'
import { Check, Link2, MessageCircle } from 'lucide-react'

import { whatsappShareHref, type ProfileShare } from '@/lib/profileShareCore'

// "Copy profile link" + "Share on WhatsApp" (owner, 20 Oct 2026). Both carry
// the clean public profile address. When the profile is not public both are
// disabled and the reason is shown under them (lib/profileShareCore).

const BTN =
  'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold disabled:cursor-not-allowed'

export default function ProfileShareButtons({ share, className = '' }: { share: ProfileShare; className?: string }) {
  const [copied, setCopied] = useState(false)
  const url = share.url

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const t = document.createElement('textarea')
      t.value = url
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!url}
          title={share.disabledReason ?? undefined}
          className={`${BTN} border-gray-200 bg-white text-tm-navy hover:border-tm-navy disabled:text-gray-500 disabled:hover:border-gray-200`}
        >
          {copied ? <Check aria-hidden size={12} /> : <Link2 aria-hidden size={12} />}
          {copied ? 'Copied ✓' : 'Copy profile link'}
        </button>
        {url ? (
          <a
            href={whatsappShareHref(url)}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BTN} border-tm-green-deep/40 bg-tm-tint-green text-tm-green-deep`}
          >
            <MessageCircle aria-hidden size={12} /> Share on WhatsApp
          </a>
        ) : (
          <button type="button" disabled title={share.disabledReason ?? undefined} className={`${BTN} border-gray-200 bg-white text-gray-500`}>
            <MessageCircle aria-hidden size={12} /> Share on WhatsApp
          </button>
        )}
      </div>
      {share.disabledReason && <p className="text-[10px] font-semibold text-gray-600">{share.disabledReason}</p>}
    </div>
  )
}
