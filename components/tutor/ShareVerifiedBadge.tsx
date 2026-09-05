'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'

// "Share your verified badge" — an on-demand share card for a LISTED tutor.
//
// WHY ON DEMAND. The card used to render as an always-present section on the
// dashboard, so its <img src="/api/tutor/social/verified"> fired a satori image
// render on EVERY dashboard load — a server cost paid on each visit, for a
// conversion surface almost nobody used. It is now a small text link in the
// header card; the image (and its render) happens only when the tutor opens the
// dialog. Nothing is generated before the click. The Claude API is not involved.
//
// WhatsApp and Facebook share the profile LINK with a caption (their web share
// intents take a URL, not a file). Instagram has no web share intent, so Save
// downloads the PNG for the tutor to post — which is also the Save button for
// any platform. Nothing here posts on the tutor's behalf.

const IMAGE_URL = '/api/tutor/social/verified?format=square'

export default function ShareVerifiedBadge({
  profileUrl,
  firstName,
}: {
  profileUrl: string
  firstName: string
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const caption = `I'm now a verified tutor on TutorMint! Find me here:`
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${caption} ${profileUrl}`)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileUrl)}`

  // Escape closes; focus moves into the dialog on open and back to the trigger
  // on close — the same accessibility contract as ConfirmDialog.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => closeRef.current?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[32px] items-center gap-1 text-[11px] font-bold text-tm-green-deep underline-offset-2 hover:underline"
      >
        <Share2 aria-hidden size={13} />
        Share your verified badge
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-tm-black/50 p-4 sm:items-center"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-badge-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Share2 aria-hidden size={16} className="text-tm-green-deep" />
                <h2 id="share-badge-title" className="text-sm font-black text-tm-navy">
                  You&rsquo;re verified, {firstName} 🎉
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-tm-bg"
              >
                <X aria-hidden size={16} />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-700">
              Share your verified badge — it tells parents you&rsquo;re the real thing.
            </p>

            {/* The image renders only now, when the dialog is open — never on a
                plain dashboard load. eslint-disable: generated PNG from our own
                route, shown as-is so it matches what downloads. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={IMAGE_URL}
              alt="Your You're Verified card"
              className="w-full rounded-xl border border-tm-green-deep/20 bg-white"
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
          </div>
        </div>
      )}
    </>
  )
}
