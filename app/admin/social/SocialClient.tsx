'use client'

import { submitSignal } from '@/lib/submit'

import { useMemo, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import Typeahead from '@/components/search/Typeahead'
import { useToast } from '@/components/ui/Toast'

export type PickerTutor = {
  slug: string
  name: string
  headline: string | null
  city: string | null
  area: string | null
  subjects: string[]
  rating: number
  ratingCount: number
}

const TEMPLATES = [
  { code: 'spotlight', label: 'Spotlight', blurb: 'Light background, profile-led' },
  { code: 'bold', label: 'Bold', blurb: 'Dark background, high contrast for feeds' },
  { code: 'success', label: 'Success story', blurb: '“Congratulations” — verified or hired' },
  { code: 'announcement', label: 'Announcement', blurb: 'Navy, for roundups and events' },
]

const FORMATS = [
  { code: 'square', label: 'Square', size: '1080 × 1080', hint: 'Instagram / Facebook feed' },
  { code: 'story', label: 'Story', size: '1080 × 1920', hint: 'Instagram / WhatsApp status' },
  { code: 'wide', label: 'Wide', size: '1200 × 630', hint: 'Link previews, X, LinkedIn' },
]

// Pick a tutor, pick a look, download the PNG and copy the caption.
//
// Only the headline (and, for an announcement, a date and a detail line) is
// editable. Everything else — name, badges, subjects, city, rating — comes from
// the live profile, so what gets posted about a tutor and what the site says
// about them cannot disagree. That constraint is the feature.
//
// The tutor is chosen through the platform typeahead (suggest={false}): the
// public suggestion index holds listed tutors and open jobs, which is not the
// set this screen searches, so it filters the loaded list by name, area or
// subject as the admin types. A plain <select> stops working past a few dozen.

export default function SocialClient({ tutors }: { tutors: PickerTutor[] }) {
  const [slug, setSlug] = useState(tutors[0]?.slug ?? '')
  const [query, setQuery] = useState('')
  const [template, setTemplate] = useState('spotlight')
  const [format, setFormat] = useState('square')
  const [headline, setHeadline] = useState('')
  const [subhead, setSubhead] = useState('')
  const [dateLabel, setDateLabel] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const tutor = useMemo(() => tutors.find((t) => t.slug === slug) ?? null, [tutors, slug])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const scored = needle
      ? tutors.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            (t.area ?? '').toLowerCase().includes(needle) ||
            (t.city ?? '').toLowerCase().includes(needle) ||
            t.subjects.some((s) => s.toLowerCase().includes(needle)),
        )
      : tutors
    return scored.slice(0, 8)
  }, [query, tutors])

  const isAnnouncement = template === 'announcement'

  const imageUrl = useMemo(() => {
    const p = new URLSearchParams({ slug, format, template })
    if (headline.trim()) p.set('headline', headline.trim())
    if (isAnnouncement && subhead.trim()) p.set('subhead', subhead.trim())
    if (isAnnouncement && dateLabel.trim()) p.set('date', dateLabel.trim())
    return `/api/admin/social/image?${p}`
  }, [slug, format, template, headline, subhead, dateLabel, isAnnouncement])

  const caption = useMemo(() => {
    if (!tutor) return ''
    const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
    const subjects = tutor.subjects.slice(0, 3).join(', ')
    const tags = [
      '#TutorMint',
      tutor.city ? `#${tutor.city.replace(/\s+/g, '')}Tutor` : null,
      ...tutor.subjects.slice(0, 2).map((s) => `#${s.replace(/[^A-Za-z0-9]/g, '')}`),
      '#VerifiedTutors',
    ].filter(Boolean)

    return [
      `Meet ${tutor.name} — a verified tutor on TutorMint.`,
      subjects ? `Teaching ${subjects}${place ? ` in ${place}` : ''}.` : place ? `Based in ${place}.` : '',
      tutor.ratingCount > 0 ? `Rated ${tutor.rating.toFixed(1)}★ by ${tutor.ratingCount} parent${tutor.ratingCount === 1 ? '' : 's'}.` : '',
      '',
      `Hire verified tutors on tutormint.org`,
      `https://tutormint.org/tutor/${tutor.slug}`,
      '',
      tags.join(' '),
    ]
      .filter((l) => l !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }, [tutor])

  const download = async () => {
    setBusy(true)
    try {
      // Audited before the download, not on every preview keystroke.
      await fetch('/api/admin/social', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, template, format, edited: headline.trim().length > 0 }),
      })

      const res = await fetch(imageUrl, { signal: submitSignal() })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tutormint-${slug}-${template}-${format}.png`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Image downloaded.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not render that image.')
    } finally {
      setBusy(false)
    }
  }

  if (tutors.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No listed tutors to post about yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs leading-relaxed text-gray-500">
          Everything but the headline comes from the tutor&rsquo;s live profile. Only listed tutors
          appear here — suspended accounts and unclaimed imports are not promoted.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-500">Tutor</span>
              <Typeahead
                placeholder="Search by name, area or subject…"
                ariaLabel="Search tutors"
                suggest={false}
                onQueryChange={setQuery}
              />
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {matches.map((t) => (
                  <li key={t.slug}>
                    <button
                      type="button"
                      onClick={() => setSlug(t.slug)}
                      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left ${
                        slug === t.slug ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold text-tm-navy">{t.name}</span>
                        <span className="block truncate text-[10px] text-gray-500">
                          {[t.area, t.city].filter(Boolean).join(', ') || 'Pakistan'}
                          {t.subjects.length > 0 ? ` · ${t.subjects.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </span>
                      {slug === t.slug && <span className="shrink-0 text-[10px] font-bold text-tm-navy">Selected</span>}
                    </button>
                  </li>
                ))}
                {matches.length === 0 && (
                  <li className="px-1 py-2 text-[11px] text-gray-500">No tutor matches that.</li>
                )}
              </ul>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[11px] font-bold text-gray-500">Template</legend>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setTemplate(t.code)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs font-bold ${
                      template === t.code ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                    }`}
                  >
                    {t.label}
                    <span className="block text-[10px] font-normal text-gray-500">{t.blurb}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-[11px] font-bold text-gray-500">Format</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => setFormat(f.code)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs font-bold ${
                      format === f.code ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                    }`}
                  >
                    {f.label}
                    <span className="block text-[10px] font-normal text-gray-500">{f.size}</span>
                    <span className="block text-[10px] font-normal text-gray-500">{f.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-gray-500">
                {template === 'success'
                  ? 'Headline (the occasion — e.g. “You’re Verified!”)'
                  : template === 'announcement'
                    ? 'Headline (the announcement)'
                    : 'Headline (optional — replaces the tutor’s own)'}
              </span>
              <input
                value={headline}
                maxLength={90}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder={
                  template === 'success'
                    ? "You're Verified!"
                    : template === 'announcement'
                      ? 'New verified tutors this month'
                      : (tutor?.headline ?? 'Verified tutor on TutorMint')
                }
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
              />
              <span className="block text-[10px] text-gray-500">{headline.length}/90</span>
            </label>

            {isAnnouncement && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-gray-500">Date (optional)</span>
                  <input
                    value={dateLabel}
                    maxLength={40}
                    onChange={(e) => setDateLabel(e.target.value)}
                    placeholder="September 2026"
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-gray-500">Detail / venue (optional)</span>
                  <input
                    value={subhead}
                    maxLength={90}
                    onChange={(e) => setSubhead(e.target.value)}
                    placeholder="tutormint.org"
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                  />
                </label>
              </div>
            )}

            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              <Download size={14} />
              {busy ? 'Rendering…' : 'Download PNG'}
            </button>
          </section>

          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-tm-navy">Caption</h2>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(caption)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700"
              >
                <Copy size={14} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-tm-bg p-3 font-sans text-xs leading-relaxed">
              {caption}
            </pre>
          </section>
        </div>

        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">Preview</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- this is a
              generated PNG from our own route, deliberately not optimised so
              the preview is byte-for-byte what downloads. */}
          <img
            key={imageUrl}
            src={imageUrl}
            alt={`Preview for ${tutor?.name}`}
            className="w-full rounded-xl border border-gray-200"
          />
          <p className="text-[10px] leading-relaxed text-gray-500">
            Posting is manual: download the image, copy the caption, publish from the TutorMint
            account.
          </p>
        </section>
      </div>
    </div>
  )
}
