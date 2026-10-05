'use client'

import { useEffect, useState } from 'react'

// The "✓ You're verified!" banner, shown ONCE (owner, 5 Oct 2026): the server
// renders this only on the first dashboard visit after the Verified badge is
// assigned and records that visit (tutor_profiles.verified_banner_seen_at) in
// the same request, so it never comes back on any device. This component owns
// the 3-second auto-hide: a short fade, then the space it used collapses
// smoothly (max-height + margin transition) so the page below slides up rather
// than jumping. Reduced-motion readers get the same end state via the global
// rule that shortens every transition.

const SHOW_MS = 3000
const FADE_MS = 350
const COLLAPSE_MS = 300

export default function VerifiedOnceBanner() {
  const [phase, setPhase] = useState<'shown' | 'fading' | 'collapsed' | 'gone'>('shown')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fading'), SHOW_MS)
    const t2 = setTimeout(() => setPhase('collapsed'), SHOW_MS + FADE_MS)
    const t3 = setTimeout(() => setPhase('gone'), SHOW_MS + FADE_MS + COLLAPSE_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      aria-hidden={phase !== 'shown'}
      className="overflow-hidden transition-[max-height,margin] duration-300 ease-out"
      style={{ maxHeight: phase === 'collapsed' ? 0 : 160, marginTop: phase === 'collapsed' ? -12 : 0 }}
    >
      <div
        role="status"
        className={`rounded-2xl border border-tm-green-deep/25 bg-tm-tint-green/60 px-4 py-3 text-center transition-opacity duration-300 ${
          phase === 'shown' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <p className="text-sm font-black text-tm-green-deep">✓ You&rsquo;re verified! You can now apply to tuitions.</p>
        <p lang="ur" dir="rtl" className="mt-0.5 text-[11px] font-semibold text-tm-green-deep/80">
          آپ کی تصدیق ہو گئی ہے! اب آپ ٹیوشنز کے لیے اپلائی کر سکتے ہیں۔
        </p>
      </div>
    </div>
  )
}
