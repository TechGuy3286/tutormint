'use client'

import { useState } from 'react'
import { Share2, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { SHARE_FALLBACK_LINE, shareMode, statusImageFileName, VERIFIED_CARD_TITLE } from '@/lib/social/statusImageCore'

// "Share on WhatsApp Status" (owner, 26 Oct 2026) — for a tutor with the
// Verified badge. On a phone the share sheet opens with the "I'm a Verified
// Tutor" Story image attached (WhatsApp → My status); where a browser cannot
// share files the image downloads with one line of instructions instead.

async function fetchImage(imageKey: string, name: string): Promise<File | null> {
  const res = await fetch(`/api/tutor/social/status?k=${encodeURIComponent(imageKey)}`)
  if (!res.ok) return null
  const blob = await res.blob()
  return new File([blob], statusImageFileName(name), { type: 'image/png' })
}

export function useShareStatus(imageKey: string, name: string) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  async function share() {
    setBusy(true)
    setNote(null)
    try {
      const file = await fetchImage(imageKey, name)
      if (!file) return toast.error('The image did not load. Please try again.')
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      const mode = shareMode({ canShareFiles: !!nav.share && !!nav.canShare && nav.canShare({ files: [file] }) })
      if (mode === 'share-sheet') {
        try {
          await nav.share({ files: [file] })
          return
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') return
          // fall through to the download
        }
      }
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setNote(SHARE_FALLBACK_LINE)
    } finally {
      setBusy(false)
    }
  }
  return { share, busy, note }
}

export default function ShareStatusButton({ imageKey, name }: { imageKey: string; name: string }) {
  const { share, busy, note } = useShareStatus(imageKey, name)
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void share()}
        disabled={busy}
        data-share-status=""
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
      >
        <Share2 aria-hidden size={16} />
        {busy ? 'Preparing…' : 'Share on WhatsApp Status'}
      </button>
      {note && <span className="text-[11px] text-slate-700" role="status">{note}</span>}
    </span>
  )
}

/** The one-time "You're verified! Share it on your status" card — the tutor dismisses it for good. */
export function StatusShareCard({ imageKey, name }: { imageKey: string; name: string }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  const dismiss = () => {
    setHidden(true)
    void fetch('/api/tutor/status-card', { method: 'POST' }).catch(() => {})
  }
  return (
    <section className="relative space-y-2 rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-4" data-status-card="">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-tm-green-deep hover:bg-white/60"
      >
        <X aria-hidden size={16} />
      </button>
      <p className="pr-8 text-sm font-black text-tm-green-deep">{VERIFIED_CARD_TITLE}</p>
      <ShareStatusButton imageKey={imageKey} name={name} />
    </section>
  )
}
