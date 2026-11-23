'use client'

import { useRef, useState, type ClipboardEvent } from 'react'
import { ClipboardPaste, ImageUp, Loader2, ShieldCheck } from 'lucide-react'

import { redactForAi } from '@/lib/postRedactCore'
import { AI_UNAVAILABLE, type AiFill } from '@/lib/aiTuitionExtractCore'
import { IMAGE_MAX_BYTES, IMAGE_TOO_BIG, IMAGE_WRONG_TYPE, imageTypeOk } from '@/lib/imageMaskCore'

/** Shrink an image in the browser to at most 2000 px (the server reads at that
 *  size anyway) so the upload stays well under the 4.5 MB request limit. The
 *  file is never stored — not here, not on the server. */
async function shrinkForUpload(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
    return out ?? file
  } catch {
    return file
  }
}

// "Paste a post" (owner, 23 Nov 2026 — PR-18 Part A) — the top of staff Post a
// tuition. Staff paste a raw Facebook / WhatsApp tuition post; the numbers are
// taken out HERE, in the browser, before anything is sent (lib/postRedactCore),
// the AI reads only the rest, and the answer pre-fills the form below. The
// parent's number goes into the form from this page, never through the AI.
// Nothing is posted: staff check the highlighted fields and press Post.

export default function PastePostBox({ onFilled }: { onFilled: (fill: AiFill, mobile: string | null) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // "Read from image" (PR-20 Part C): upload or Ctrl+V a screenshot. The server
  // blacks out every phone number with plain OCR BEFORE the AI sees the image,
  // and hands the numbers back for the form.
  const readImage = async (file: File | Blob | null) => {
    setError(null)
    setNote(null)
    if (!file) return
    if (!imageTypeOk(file.type)) {
      setError(IMAGE_WRONG_TYPE)
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError(IMAGE_TOO_BIG)
      return
    }
    setImgBusy(true)
    try {
      const body = new FormData()
      body.append('image', await shrinkForUpload(file), 'image.jpg')
      const res = await fetch('/api/admin/jobs/ai-extract-image', { method: 'POST', body })
      const j = (await res.json().catch(() => ({}))) as { fill?: AiFill; mobiles?: string[]; error?: string }
      if (!res.ok || !j.fill) {
        setError(j.error ?? AI_UNAVAILABLE)
        return
      }
      const mobiles = j.mobiles ?? []
      onFilled(j.fill, mobiles[0] ?? null)
      const checks = j.fill.uncertain.length
      setNote(
        `Filled from the image. ${checks > 0 ? `Check the ${checks === 1 ? 'highlighted field' : `${checks} highlighted fields`}, then press Post.` : 'Check every field, then press Post.'}` +
          (mobiles.length === 0 ? ' No phone number was found in the image — type it in.' : mobiles.length > 1 ? ' The image has more than one number — the first one was used.' : ''),
      )
    } catch {
      setError(AI_UNAVAILABLE)
    } finally {
      setImgBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Ctrl+V of a screenshot anywhere in this box reads the image; pasted text
  // goes into the text box as before.
  const onPaste = (e: ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    void readImage(item.getAsFile())
  }

  const fill = async () => {
    setError(null)
    setNote(null)
    const red = redactForAi(text)
    if (red.text.trim().length < 10) {
      setError('Paste the whole post first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/jobs/ai-extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: red.text }),
      })
      const j = (await res.json().catch(() => ({}))) as { fill?: AiFill; error?: string }
      if (!res.ok || !j.fill) {
        setError(j.error ?? AI_UNAVAILABLE)
        return
      }
      onFilled(j.fill, red.mobiles[0] ?? null)
      const checks = j.fill.uncertain.length
      setNote(
        `Filled. ${checks > 0 ? `Check the ${checks === 1 ? 'highlighted field' : `${checks} highlighted fields`}, then press Post.` : 'Check every field, then press Post.'}` +
          (red.mobiles.length > 1 ? ' The post has more than one number — the first one was used.' : ''),
      )
    } catch {
      setError(AI_UNAVAILABLE)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section onPaste={onPaste} className="space-y-2 rounded-2xl border border-tm-navy/20 bg-white p-4 sm:p-5" aria-label="Paste a post">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
          <ClipboardPaste size={15} aria-hidden /> Paste a post
        </h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={imgBusy || busy}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy/30 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50"
        >
          {imgBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImageUp size={14} aria-hidden />}
          {imgBusy ? 'Reading the image…' : 'Read from image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void readImage(e.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-xs text-gray-600">
        Paste a tuition post from Facebook or WhatsApp (English, Roman Urdu or Urdu), or a screenshot or poster with Read from image (or Ctrl+V; PNG, JPG or WebP, up to 8 MB). We fill the form below for you to check.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        maxLength={6000}
        placeholder="Paste the post here"
        className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed text-tm-navy outline-none focus:border-tm-red"
      />
      <p className="flex items-start gap-1.5 text-[11px] text-gray-600">
        <ShieldCheck size={13} className="mt-px shrink-0 text-tm-green-deep" aria-hidden />
        Phone numbers are taken out before anything reaches the AI — on this screen for text, and blacked out of an image first. The AI never sees them. Images are never stored.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void fill()}
          disabled={busy || text.trim().length === 0}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-300"
        >
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {busy ? 'Reading…' : 'Fill the form'}
        </button>
        {text && !busy && (
          <button
            type="button"
            onClick={() => {
              setText('')
              setNote(null)
              setError(null)
            }}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
          >
            Clear paste
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="rounded-xl bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
          {note}
        </p>
      )}
    </section>
  )
}
