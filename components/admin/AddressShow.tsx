'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useCanRevealCnic } from '@/components/admin/ReadOnly'

// A member's home address on an admin card (owner, 18 Nov 2026 — PR-07):
// masked, always ("•••••• (Lahore)"), with its label — "Read from CNIC — not
// confirmed" or "Confirmed by member". The document reviewers (the same people
// who may Show a CNIC number) get "Show", which fetches the full address from
// /api/admin/members/address-reveal — logged in the audit log first. It is held
// only in this component's memory: hidden again by "Hide", when the page is
// left or the tab is hidden. Every other role sees the masked form only.

export default function AddressShow({ memberId, masked, label }: { memberId: string; masked: string; label?: string | null }) {
  const canShow = useCanRevealCnic()
  const [full, setFull] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const { ok, data } = await adminFetch<{ address?: string | null; error?: string }>('/api/admin/members/address-reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    setBusy(false)
    if (ok) setFull(data?.address?.trim() ? data.address : '—')
    else setError(data?.error ?? 'Could not show the address.')
  }

  return (
    <span className="block space-y-1" data-address-show="">
      <span className="flex flex-wrap items-center gap-2">
        <span className="whitespace-pre-line text-xs text-slate-700">{full ?? masked}</span>
        {canShow && (
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
      </span>
      {label && <span className="block text-[11px] font-semibold text-gray-600">{label}</span>}
      {error && <span role="alert" className="block text-[11px] font-semibold text-tm-red">{error}</span>}
    </span>
  )
}
