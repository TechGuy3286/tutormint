'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'

// The CNIC number on an admin card (owner, 17 Oct 2026): masked, always. The
// Owner — and only the Owner — gets a "Show" button that fetches the full
// number from /api/admin/tutors/cnic-reveal (logged in the audit log) so it
// can be matched against the card images. It is held only in this component's
// memory: hidden again by "Hide", when the page is left (unmount) or when the
// tab is hidden. Every other role sees the masked number with no button; the
// server refuses them the full number anyway.

export default function CnicShow({
  memberId,
  masked,
  className = 'font-mono text-[11px] font-bold text-slate-700',
}: {
  memberId: string
  /** XXXXX-XXXXXXX-4 (or "Incomplete number on file"). */
  masked: string
  className?: string
}) {
  const isOwner = useCanApprove()
  const [full, setFull] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Leaving the page (or hiding the tab) hides the number again.
  useEffect(() => {
    if (!full) return
    const hide = () => setFull(null)
    const onVis = () => {
      if (document.visibilityState === 'hidden') hide()
    }
    window.addEventListener('pagehide', hide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', hide)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [full])

  const show = async () => {
    setBusy(true)
    setError(null)
    const { ok, data } = await adminFetch<{ cnicNumber?: string | null; error?: string }>('/api/admin/tutors/cnic-reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    setBusy(false)
    if (ok) setFull(data?.cnicNumber ?? '—')
    else setError(data?.error ?? 'Could not show the number.')
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={className}>{full ?? masked}</span>
      {isOwner && (
        <button
          type="button"
          onClick={() => (full ? setFull(null) : void show())}
          disabled={busy}
          className="inline-flex min-h-[28px] items-center gap-1 text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : full ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
          {full ? 'Hide' : 'Show'}
        </button>
      )}
      {error && <span role="alert" className="text-[11px] font-semibold text-tm-red">{error}</span>}
    </span>
  )
}
