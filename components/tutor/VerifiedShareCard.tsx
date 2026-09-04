'use client'

import { useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'

// The "You're Verified" celebration + share card on the tutor dashboard.
//
// Shown the moment a tutor is LISTED (the dashboard gates it on ent.listed —
// the same condition their badge appears under). The image is rendered on
// demand from their own profile by /api/tutor/social/verified; the tutor picks
// where to post it.
//
// WhatsApp and Facebook share the profile LINK with a caption (their web share
// intents take a URL, not a file). Instagram has no web share intent, so its
// button downloads the PNG for the tutor to post — which is also the Save
// button for any platform. Nothing here posts on the tutor's behalf.

const IMAGE_URL = '/api/tutor/social/verified?format=square'

export default function VerifiedShareCard({
  profileUrl,
  firstName,
}: {
  profileUrl: string
  firstName: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const caption = `I'm now a verified tutor on TutorMint! Find me here:`
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${caption} ${profileUrl}`)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileUrl)}`

  const saveImage = async () => {
    setBusy(true)
    try {
      const res = await fetch(IMAGE_URL, { signal: submitSignal() })
      if (!res.ok) throw new Error('Could not render your card.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'tutormint-verified.png'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Card saved. Post it to Instagram or wherever you like.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-4">
      <div className="flex items-center gap-2">
        <Share2 aria-hidden size={16} className="text-tm-green-deep" />
        <h2 className="text-sm font-black text-tm-navy">You&rsquo;re verified, {firstName} 🎉</h2>
      </div>
      <p className="text-xs leading-relaxed text-slate-700">
        Share your verified badge — it tells parents you&rsquo;re the real thing.
      </p>

      {/* eslint-disable-next-line @next/next/no-img-element -- generated PNG
          from our own route, shown as-is so it matches what downloads. */}
      <img
        src={IMAGE_URL}
        alt="Your You're Verified card"
        className="w-full max-w-sm rounded-xl border border-tm-green-deep/20 bg-white"
      />

      <div className="flex flex-wrap gap-2">
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover"
        >
          WhatsApp
        </a>
        <a
          href={fbHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          Facebook
        </a>
        <button
          type="button"
          onClick={saveImage}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy disabled:opacity-60"
        >
          <Download aria-hidden size={13} />
          {busy ? 'Saving…' : 'Save for Instagram'}
        </button>
      </div>
    </section>
  )
}
