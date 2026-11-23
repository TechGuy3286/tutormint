'use client'

import { useState } from 'react'
import { ClipboardPaste, Loader2, ShieldCheck } from 'lucide-react'

import { redactForAi } from '@/lib/postRedactCore'
import { AI_UNAVAILABLE, type AiFill } from '@/lib/aiTuitionExtractCore'

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
    <section className="space-y-2 rounded-2xl border border-tm-navy/20 bg-white p-4 sm:p-5" aria-label="Paste a post">
      <h2 className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
        <ClipboardPaste size={15} aria-hidden /> Paste a post
      </h2>
      <p className="text-xs text-gray-600">
        Paste a tuition post from Facebook or WhatsApp (English, Roman Urdu or Urdu). We fill the form below for you to check.
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
        Phone numbers are taken out on this screen before anything is sent. The AI never sees them.
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
