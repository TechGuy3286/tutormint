'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useCanApprove } from '@/components/admin/ReadOnly'

// "View as" (owner, 26 Oct 2026): opens the member's dashboard exactly as they
// see it, read only, for 30 minutes or until Exit. Owner only; the password is
// asked again; start and end are in Audit and on the member's Activity tab.

export default function ViewAsButton({ memberId }: { memberId: string }) {
  const isOwner = useCanApprove()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!isOwner) return null
  async function start() {
    setBusy(true)
    const { ok, data } = await adminFetch<{ redirect?: string; error?: string }>('/api/admin/view-as/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    setBusy(false)
    if (!ok || !data?.redirect) return toast.error(data?.error ?? 'The view did not start.')
    window.location.assign(data.redirect)
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void start()}
      data-view-as=""
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-tm-navy/40 bg-white px-2.5 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50"
    >
      <Eye aria-hidden size={13} />
      {busy ? 'Opening…' : 'View as'}
    </button>
  )
}
