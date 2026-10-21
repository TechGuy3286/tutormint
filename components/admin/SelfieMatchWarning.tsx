// The amber "selfie looks like the profile picture" warning (owner, 21 Oct
// 2026; lib/selfieMatch). A warning only — the Owner still decides.

import { AlertTriangle } from 'lucide-react'

import { SELFIE_MATCH_WARNING } from '@/lib/photoHashCore'

export default function SelfieMatchWarning({ compact = false }: { compact?: boolean }) {
  return (
    <p role="note" className={`flex items-start gap-1.5 rounded-lg border border-tm-gold/40 bg-tm-tint-gold font-semibold text-tm-gold-ink ${compact ? 'px-2 py-1 text-[11px]' : 'p-2 text-xs'}`}>
      <AlertTriangle size={compact ? 12 : 14} aria-hidden className="mt-0.5 shrink-0" />
      <span>{SELFIE_MATCH_WARNING}</span>
    </p>
  )
}
