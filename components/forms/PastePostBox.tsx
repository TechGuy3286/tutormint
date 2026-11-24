'use client'

import { useRef, useState, type ClipboardEvent } from 'react'
import { ClipboardPaste, ImageUp, Loader2, ShieldCheck } from 'lucide-react'

import { redactForAi } from '@/lib/postRedactCore'
import { AI_UNAVAILABLE, type AiFill } from '@/lib/aiTuitionExtractCore'
import { IMAGE_MAX_BYTES, IMAGE_PICK_MAX_BYTES, IMAGE_TOO_BIG, IMAGE_TOO_SLOW, IMAGE_WRONG_TYPE } from '@/lib/imageMaskCore'

/** Open any picture the browser can decode (PNG, JPG, WebP; HEIC on iPhone
 *  Safari), turned upright by its EXIF orientation. null = it cannot be opened. */
async function decodeImage(file: Blob): Promise<{ draw: CanvasImageSource; w: number; h: number; done: () => void } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { draw: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
  } catch {
    // Older Safari: an <img> decodes what createImageBitmap does not.
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) return null
    return { draw: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

/** The picture as a JPEG of at most 2000 px (the size the server reads at), so
 *  a phone photo (HEIC included, where the browser can open it) uploads well
 *  under the 4 MB limit. null = the browser could not open it. The file is
 *  never stored — not here, not on the server. */
async function shrinkForUpload(file: Blob): Promise<Blob | null> {
  const pic = await decodeImage(file)
  if (!pic) return null
  try {
    const scale = Math.min(1, 2000 / Math.max(pic.w, pic.h))
    const w = Math.max(1, Math.round(pic.w * scale))
    const h = Math.max(1, Math.round(pic.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(pic.draw, 0, 0, w, h)
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
  } catch {
    return null
  } finally {
    pic.done()
  }
}

/** A failed answer that is not our JSON (a platform limit or timeout) in plain words. */
function platformError(status: number): string {
  if (status === 413) return IMAGE_TOO_BIG
  if (status === 504 || status === 408) return IMAGE_TOO_SLOW
  return AI_UNAVAILABLE
}

/** The browser gives up a little after the server's own 120 s limit. */
const IMAGE_CLIENT_TIMEOUT_MS = 125_000

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
    // Any picture type is tried (HEIC from a phone too): the browser turns it
    // into a JPEG, and says so plainly when it cannot open it.
    if (file.type && !file.type.startsWith('image/')) {
      setError(IMAGE_WRONG_TYPE)
      return
    }
    if (file.size > IMAGE_PICK_MAX_BYTES) {
      setError(IMAGE_TOO_BIG)
      return
    }
    setImgBusy(true)
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), IMAGE_CLIENT_TIMEOUT_MS)
    try {
      const jpeg = await shrinkForUpload(file)
      if (!jpeg) {
        setError(IMAGE_WRONG_TYPE)
        return
      }
      if (jpeg.size > IMAGE_MAX_BYTES) {
        setError(IMAGE_TOO_BIG)
        return
      }
      const body = new FormData()
      body.append('image', jpeg, 'image.jpg')
      const res = await fetch('/api/admin/jobs/ai-extract-image', { method: 'POST', body, signal: abort.signal })
      const j = (await res.json().catch(() => null)) as { fill?: AiFill; mobiles?: string[]; error?: string } | null
      if (!j) {
        setError(platformError(res.status))
        return
      }
      if (!res.ok || !j.fill) {
        setError(j.error ?? platformError(res.status))
        return
      }
      const mobiles = j.mobiles ?? []
      onFilled(j.fill, mobiles[0] ?? null)
      const checks = j.fill.uncertain.length
      setNote(
        `Filled from the image. ${checks > 0 ? `Check the ${checks === 1 ? 'highlighted field' : `${checks} highlighted fields`}, then press Post.` : 'Check every field, then press Post.'}` +
          (mobiles.length === 0 ? ' No phone number was found in the image — type it in.' : mobiles.length > 1 ? ' The image has more than one number — the first one was used.' : ''),
      )
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'AbortError' ? IMAGE_TOO_SLOW : AI_UNAVAILABLE)
    } finally {
      clearTimeout(timer)
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
        setError(j.error ?? platformError(res.status))
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
          {imgBusy ? 'Reading image…' : 'Read from image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => void readImage(e.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-xs text-gray-600">
        Paste a tuition post from Facebook or WhatsApp (English, Roman Urdu or Urdu), or a screenshot or poster with Read from image (or Ctrl+V; a screenshot, PNG or JPG works best). We fill the form below for you to check.
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
      {imgBusy && (
        <p role="status" className="flex items-center gap-1.5 rounded-xl bg-tm-bg p-3 text-xs font-bold text-tm-navy">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Reading image… this can take up to a minute. The form below still works.
        </p>
      )}
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
