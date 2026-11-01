'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { TAGLINE_MAX, BIO_MAX } from '@/lib/ai/taglineBrief'

// Tagline & About in tutor Settings (owner, 2 Nov 2026, Part F). The tutor edits
// both any time, with the limits shown. "Write it for me again" drafts both from
// their own saved profile (/api/tutor/tagline — the existing AI drafting: no
// invented facts, no prices, no superlatives; it saves nothing). Save goes
// through /api/profile/save, which logs the change and rebuilds the cached
// public profile.

export default function TaglineAboutEditor({
  initialHeadline,
  initialBio,
  onSaved,
}: {
  initialHeadline: string
  initialBio: string
  onSaved: (headline: string, bio: string) => void
}) {
  const toast = useToast()
  const [headline, setHeadline] = useState(initialHeadline)
  const [bio, setBio] = useState(initialBio)
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)

  const draft = async () => {
    setDrafting(true)
    try {
      const res = await fetch('/api/tutor/tagline', { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { tagline?: string; bio?: string; error?: string }
      if (!res.ok || !j.tagline || !j.bio) throw new Error(j.error ?? 'We could not write it right now. Please try again.')
      setHeadline(j.tagline.slice(0, TAGLINE_MAX))
      setBio(j.bio.slice(0, BIO_MAX))
      toast.success('Written from your profile. Check it, then Save.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not write it right now. Please try again.')
    } finally {
      setDrafting(false)
    }
  }

  const save = async () => {
    const h = headline.trim()
    const b = bio.trim()
    if (!h || !b) return toast.error('Write a tagline and a few lines about you.')
    setSaving(true)
    try {
      const res = await fetch('/api/profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorProfile: { headline: h, bio: b } }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? 'That did not save. Please try again.')
      toast.success('Saved. Your public profile shows it now.')
      onSaved(h, b)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3" data-tagline-about="">
      <label className="block space-y-1">
        <span className="flex items-baseline justify-between text-xs font-bold text-tm-navy">
          Tagline <span className="font-semibold text-gray-500">{headline.length} / {TAGLINE_MAX}</span>
        </span>
        <input
          value={headline}
          maxLength={TAGLINE_MAX}
          onChange={(e) => setHeadline(e.target.value)}
          className="min-h-[48px] w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-tm-navy"
        />
      </label>
      <label className="block space-y-1">
        <span className="flex items-baseline justify-between text-xs font-bold text-tm-navy">
          About you <span className="font-semibold text-gray-500">{bio.length} / {BIO_MAX}</span>
        </span>
        <textarea
          value={bio}
          maxLength={BIO_MAX}
          rows={6}
          onChange={(e) => setBio(e.target.value)}
          className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-tm-navy"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void draft()}
          disabled={drafting}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-tm-red disabled:opacity-50"
        >
          {drafting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          Write it for me again
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-[44px] rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
