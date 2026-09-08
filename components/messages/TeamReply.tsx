'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { submitSignal } from '@/lib/submit'
import { useToast } from '@/components/ui/Toast'

// The member's reply into the official TutorMint Team conversation, shown inside
// the role inbox's Team pane. Posts to /api/account/messages; the reply appears
// in /admin/inbox.

export default function TeamReply() {
  const router = useRouter()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/account/messages', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', body: body.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not send your reply.')
      setBody('')
      toast.success('Reply sent.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send your reply.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-gray-200 p-3 sm:flex-row">
      <textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Reply to the TutorMint Team…"
        className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-tm-bg px-3 py-2 text-sm outline-none focus:border-tm-navy focus:bg-white"
      />
      <button
        type="button"
        onClick={send}
        disabled={busy || body.trim().length < 1}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-50"
      >
        <Send aria-hidden size={14} />
        {busy ? 'Sending…' : 'Send reply'}
      </button>
    </div>
  )
}
