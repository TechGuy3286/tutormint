'use client'

import { submitSignal } from '@/lib/submit'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Download, RotateCcw, Shuffle } from 'lucide-react'
import Typeahead from '@/components/search/Typeahead'
import { useToast } from '@/components/ui/Toast'
import { captionVariants, DEFAULT_SOCIAL_TEMPLATE, SOCIAL_TEMPLATES, type SocialData, type SocialTemplate } from '@/lib/social/copy'
import { cropQuery, MOVE_STEPS, NO_ADJUST, ZOOM_MAX, ZOOM_MIN, type CropAdjust } from '@/lib/social/cropCore'
import { defaultGroup, GROUP_MAX, GROUP_MIN, shufflePick, TEMPLATE_INFO, templateUnavailable } from '@/lib/social/templates'

const SITE_ORIGIN = 'https://www.tutormint.org'

export type PickerTutor = {
  slug: string
  name: string
  headline: string | null
  city: string | null
  area: string | null
  subjects: string[]
  rating: number
  ratingCount: number
  experienceYears: number | null
  teachingMode: string | null
  /** Whether the tutor is currently listed (in tutor_directory). */
  listed: boolean
  /** Card fields that would render blank (named for the poster). */
  missing: string[]
  /** "Hide my photo from parents" is on — posts use the grey silhouette. */
  photoHidden: boolean
  /** The REAL earned badges — an unlisted tutor has none. */
  badges: ('Verified' | 'Premium' | 'Featured')[]
  /** When they became verified (the group post defaults to the most recent). */
  verifiedAt: string | null
}

const FORMATS = [
  { code: 'square', label: 'Square', size: '1080 × 1080', hint: 'Instagram / Facebook feed' },
  { code: 'story', label: 'Story', size: '1080 × 1920', hint: 'Instagram / WhatsApp status' },
  { code: 'wide', label: 'Wide', size: '1200 × 630', hint: 'Link previews, X, LinkedIn' },
] as const

// Pick a tutor, pick a look, download the PNG and copy the caption.
//
// Only the headline (and, for an announcement, a date and a detail line) is
// editable. Everything else — name, badges, subjects, city — comes from the live
// profile, so what gets posted about a tutor and what the site says about them
// cannot disagree. That constraint is the feature.
//
// PR C3 (owner, 21 Oct 2026): twelve templates, two colour looks for the new
// ones, Shuffle (a random template and look — never the previous template for
// that tutor; a tutor who hid their photo only gets photo-free templates), three
// caption versions with "Next caption", and the group post (a city, then 4–6 of
// its verified tutors, defaulting to the most recently verified).

export default function SocialClient({ tutors }: { tutors: PickerTutor[] }) {
  const [slug, setSlug] = useState(tutors[0]?.slug ?? '')
  const [query, setQuery] = useState('')
  const [template, setTemplate] = useState<SocialTemplate>(DEFAULT_SOCIAL_TEMPLATE)
  const [variant, setVariant] = useState(0)
  const [format, setFormat] = useState<'square' | 'story' | 'wide'>('square')
  const [headline, setHeadline] = useState('')
  const [subhead, setSubhead] = useState('')
  const [dateLabel, setDateLabel] = useState('')
  const [successKind, setSuccessKind] = useState<'verified' | 'hired'>('verified')
  const [captionIndex, setCaptionIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  // The last Shuffle pick per tutor, so the next one is always different.
  const lastShuffle = useRef(new Map<string, SocialTemplate>())

  // Group post: a city, then 4–6 of its verified tutors.
  const cities = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tutors) {
      const c = t.city?.trim()
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()].filter(([, n]) => n >= GROUP_MIN).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [tutors])
  const [groupCity, setGroupCity] = useState(cities[0] ?? '')
  const cityTutors = useMemo(() => tutors.filter((t) => t.city?.trim() === groupCity), [tutors, groupCity])
  const [groupSlugs, setGroupSlugs] = useState<string[]>(() => defaultGroup(tutors.filter((t) => t.city?.trim() === (cities[0] ?? ''))).map((t) => t.slug))
  const chooseCity = (c: string) => {
    setGroupCity(c)
    setGroupSlugs(defaultGroup(tutors.filter((t) => t.city?.trim() === c)).map((t) => t.slug))
  }
  const toggleGroup = (s: string) =>
    setGroupSlugs((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= GROUP_MAX ? cur : [...cur, s]))

  // Zoom / move the photo for THIS post only. It travels on the image URL and
  // is never saved — not to the tutor's profile, not anywhere.
  const [crop, setCrop] = useState<CropAdjust>(NO_ADJUST)
  const [zoomDraft, setZoomDraft] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => setCrop((c) => (c.zoom === zoomDraft ? c : { ...c, zoom: zoomDraft })), 350)
    return () => clearTimeout(t)
  }, [zoomDraft])
  const tutor = useMemo(() => tutors.find((t) => t.slug === slug) ?? null, [tutors, slug])

  const chooseTemplate = (t: SocialTemplate, v = 0) => {
    setTemplate(t)
    setVariant(v)
    setCaptionIndex(0)
  }
  const pickTutor = (next: string) => {
    setSlug(next)
    setCrop(NO_ADJUST)
    setZoomDraft(1)
    setCaptionIndex(0)
    // A template this tutor cannot use falls back to the default.
    const t = tutors.find((x) => x.slug === next)
    if (t && templateUnavailable(template, t)) chooseTemplate(DEFAULT_SOCIAL_TEMPLATE)
  }
  const move = (dx: number, dy: number) =>
    setCrop((c) => ({
      ...c,
      x: Math.max(-MOVE_STEPS, Math.min(MOVE_STEPS, c.x + dx)),
      y: Math.max(-MOVE_STEPS, Math.min(MOVE_STEPS, c.y + dy)),
    }))

  const shuffle = () => {
    if (!tutor) return
    const prev = lastShuffle.current.get(tutor.slug) ?? template
    const pick = shufflePick({ format, photoHidden: tutor.photoHidden, hasHeadline: !!tutor.headline?.trim(), previous: prev })
    lastShuffle.current.set(tutor.slug, pick.template)
    chooseTemplate(pick.template, pick.variant)
  }

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

  const info = TEMPLATE_INFO[template]
  const isGroup = template === 'group'
  const isAnnouncement = template === 'announcement'
  const isSuccess = template === 'success'
  const groupReady = isGroup && !!groupCity && groupSlugs.length >= GROUP_MIN && groupSlugs.length <= GROUP_MAX
  const unavailable = !isGroup && tutor ? templateUnavailable(template, tutor) : null
  const usesPhoto = !isGroup && template !== 'justverified'

  const imageUrl = useMemo(() => {
    const p = new URLSearchParams({ format, template })
    if (variant) p.set('v', String(variant))
    if (isGroup) {
      p.set('city', groupCity)
      p.set('slugs', groupSlugs.join(','))
      return `/api/admin/social/image?${p}`
    }
    p.set('slug', slug)
    if (info.usesHeadline && headline.trim()) p.set('headline', headline.trim())
    if (isAnnouncement && subhead.trim()) p.set('subhead', subhead.trim())
    if (isAnnouncement && dateLabel.trim()) p.set('date', dateLabel.trim())
    if (isSuccess) p.set('kind', successKind)
    for (const [k, v] of Object.entries(cropQuery(crop))) p.set(k, v)
    return `/api/admin/social/image?${p}`
  }, [slug, format, template, variant, headline, subhead, dateLabel, isAnnouncement, isSuccess, isGroup, successKind, crop, groupCity, groupSlugs, info.usesHeadline])

  // The captions are built from the SAME copy module the creative renders from,
  // so what is pasted and what is drawn cannot diverge. Three versions: the same
  // facts, link and hashtags, the tagline kept, different wording.
  const captions = useMemo(() => {
    if (isGroup) {
      const members = groupSlugs.map((s) => tutors.find((t) => t.slug === s)).filter(Boolean) as PickerTutor[]
      const data: SocialData = {
        slug: '',
        name: '',
        badges: [],
        subjects: [],
        ratingAvg: null,
        ratingCount: null,
        experienceYears: null,
        teachingMode: null,
        city: groupCity,
        area: null,
        profileUrl: SITE_ORIGIN,
        group: { city: groupCity, tutors: members.map((m) => ({ name: m.name, subject: m.subjects[0] ?? null })) },
      }
      return captionVariants('group', data)
    }
    if (!tutor) return ['', '', '']
    const data: SocialData = {
      slug: tutor.slug,
      name: tutor.name,
      tutorHeadline: tutor.headline,
      badges: [],
      subjects: tutor.subjects,
      ratingAvg: tutor.rating,
      ratingCount: tutor.ratingCount,
      experienceYears: tutor.experienceYears,
      teachingMode: tutor.teachingMode,
      city: tutor.city,
      area: tutor.area,
      profileUrl: `${SITE_ORIGIN}/tutor/${tutor.slug}`,
      successKind,
      headline: info.usesHeadline ? headline.trim() || null : null,
    }
    return captionVariants(template, data)
  }, [tutor, template, headline, successKind, isGroup, groupCity, groupSlugs, tutors, info.usesHeadline])
  const caption = captions[captionIndex % captions.length]

  const download = async () => {
    setBusy(true)
    try {
      // Audited before the download, not on every preview keystroke.
      await fetch('/api/admin/social', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: isGroup ? groupSlugs.join(',') : slug, template, format, edited: info.usesHeadline && headline.trim().length > 0 }),
      })

      const res = await fetch(imageUrl, { signal: submitSignal() })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = isGroup ? `tutormint-${groupCity.toLowerCase().replace(/\W+/g, '-')}-tutors-${format}.png` : `tutormint-${slug}-${template}-${format}.png`
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
          No verified tutors to post about yet. A tutor shows up as soon as they&rsquo;re verified.
        </p>
      </div>
    )
  }

  const canRender = isGroup ? groupReady : !!tutor && !unavailable

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs leading-relaxed text-gray-500">
          Only verified tutors appear here. A tutor shows up as soon as they&rsquo;re verified.
          Everything but the headline comes from the tutor&rsquo;s live profile.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            {isGroup ? (
              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-gray-500">City</span>
                  <select
                    value={groupCity}
                    onChange={(e) => chooseCity(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                  >
                    {cities.length === 0 && <option value="">No city has {GROUP_MIN} verified tutors yet</option>}
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[11px] font-bold text-gray-500">
                  Tutors ({groupSlugs.length} of {GROUP_MIN}–{GROUP_MAX} chosen)
                </p>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {cityTutors.map((t) => {
                    const on = groupSlugs.includes(t.slug)
                    const full = !on && groupSlugs.length >= GROUP_MAX
                    return (
                      <li key={t.slug}>
                        <label className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 ${on ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'} ${full ? 'opacity-60' : ''}`}>
                          <input type="checkbox" checked={on} disabled={full} onChange={() => toggleGroup(t.slug)} className="h-4 w-4 accent-tm-navy" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-tm-navy">{t.name}</span>
                            <span className="block truncate text-[10px] text-gray-500">
                              {t.subjects[0] ?? 'No subject yet'}
                              {t.photoHidden ? ' · photo hidden (grey avatar)' : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-gray-500">Tutor</span>
                <Typeahead placeholder="Search by name, area or subject…" ariaLabel="Search tutors" suggest={false} onQueryChange={setQuery} />
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {matches.map((t) => (
                    <li key={t.slug}>
                      <button
                        type="button"
                        onClick={() => pickTutor(t.slug)}
                        className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left ${
                          slug === t.slug ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-tm-navy">{t.name}</span>
                            {t.badges.map((b) => (
                              <span key={b} className="shrink-0 rounded-full bg-tm-tint-green px-1.5 text-[9px] font-black text-tm-green-deep">
                                {b}
                              </span>
                            ))}
                          </span>
                          <span className="block truncate text-[10px] text-gray-500">
                            {[t.area, t.city].filter(Boolean).join(', ') || 'Pakistan'}
                            {t.subjects.length > 0 ? ` · ${t.subjects.slice(0, 2).join(', ')}` : ''}
                          </span>
                          {t.photoHidden && <span className="block text-[9px] font-semibold text-gray-500">Photo hidden — posts use a grey avatar</span>}
                          {t.listed ? (
                            <span className="block text-[9px] font-bold text-tm-green-deep">Listed</span>
                          ) : (
                            <span className="block text-[9px] font-semibold text-tm-gold-ink">
                              Not listed{t.missing.length > 0 ? ` · blank: ${t.missing.join(', ')}` : ''}
                            </span>
                          )}
                        </span>
                        {slug === t.slug && <span className="shrink-0 text-[10px] font-bold text-tm-navy">Selected</span>}
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && <li className="px-1 py-2 text-[11px] text-gray-500">No tutor matches that.</li>}
                </ul>
              </div>
            )}

            <fieldset className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-[11px] font-bold text-gray-500">Template</legend>
                <button
                  type="button"
                  onClick={shuffle}
                  disabled={!tutor}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700 disabled:opacity-60"
                >
                  <Shuffle size={14} /> Shuffle
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SOCIAL_TEMPLATES.map((code) => {
                  const t = TEMPLATE_INFO[code]
                  const off = code !== 'group' && tutor ? templateUnavailable(code, tutor) : null
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={!!off}
                      onClick={() => chooseTemplate(code)}
                      className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs font-bold disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 ${
                        template === code ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                      }`}
                    >
                      {t.label}
                      <span className="block text-[10px] font-normal text-gray-500">{off ?? t.blurb}</span>
                    </button>
                  )
                })}
              </div>
              {info.variants > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-gray-500">Colour</span>
                  {Array.from({ length: info.variants }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setVariant(i)}
                      className={`min-h-[44px] rounded-xl border px-3 text-xs font-bold ${variant === i ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'}`}
                    >
                      Look {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-[11px] font-bold text-gray-500">Format</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => setFormat(f.code)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs font-bold ${format === f.code ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'}`}
                  >
                    {f.label}
                    <span className="block text-[10px] font-normal text-gray-500">{f.size}</span>
                    <span className="block text-[10px] font-normal text-gray-500">{f.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {info.usesHeadline ? (
              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-gray-500">
                  {template === 'verified'
                    ? 'Headline (optional — replaces the line under “I’m a Verified Tutor”)'
                    : template === 'success'
                      ? 'Headline (the occasion — e.g. “You’re Verified!”)'
                      : template === 'announcement'
                        ? 'Headline (the announcement)'
                        : template === 'spotlight' || template === 'bold'
                          ? 'Headline (optional — replaces the tutor’s own)'
                          : 'Headline (optional — replaces the standard headline)'}
                </span>
                <input
                  value={headline}
                  maxLength={90}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder={
                    template === 'verified'
                      ? 'Verified tutors get trusted by more parents.'
                      : template === 'success'
                        ? "You're Verified!"
                        : template === 'announcement'
                          ? 'New verified tutors this month'
                          : (tutor?.headline ?? 'Verified tutor on TutorMint')
                  }
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                />
                <span className="block text-[10px] text-gray-500">{headline.length}/90</span>
              </label>
            ) : (
              <p className="text-[10px] text-gray-500">This template uses only words from the profile — no headline to edit.</p>
            )}

            {isSuccess && (
              <fieldset className="space-y-2">
                <legend className="text-[11px] font-bold text-gray-500">Occasion</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['verified', 'hired'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSuccessKind(k)}
                      className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-bold ${successKind === k ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'}`}
                    >
                      {k === 'verified' ? 'Verified on TutorMint' : 'Hired through TutorMint'}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

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
              disabled={busy || !canRender}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              <Download size={14} />
              {busy ? 'Rendering…' : 'Download PNG'}
            </button>
          </section>

          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black text-tm-navy">
                Caption <span className="text-[11px] font-bold text-gray-500">({(captionIndex % 3) + 1} of 3)</span>
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCaptionIndex((i) => (i + 1) % 3)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700"
                >
                  Next caption
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard?.writeText(caption)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                      toast.success('Caption copied.')
                    } catch {
                      toast.error('Could not copy the caption.')
                    }
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700"
                >
                  <Copy size={14} />
                  {copied ? 'Copied' : 'Copy caption'}
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-tm-bg p-3 font-sans text-xs leading-relaxed">{caption}</pre>
          </section>
        </div>

        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">Preview</h2>
          {canRender ? (
            // eslint-disable-next-line @next/next/no-img-element -- a generated PNG from our own route, deliberately not optimised so the preview is byte-for-byte what downloads.
            <img key={imageUrl} src={imageUrl} alt={isGroup ? `Preview for ${groupCity}` : `Preview for ${tutor?.name}`} className="w-full rounded-xl border border-gray-200" />
          ) : (
            <p className="rounded-xl border border-gray-200 bg-tm-bg p-6 text-center text-xs text-gray-500">
              {isGroup ? `Pick a city and ${GROUP_MIN} to ${GROUP_MAX} tutors.` : (unavailable ?? 'Pick a tutor.')}
            </p>
          )}
          {usesPhoto && (
            <div className="space-y-2 rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-gray-500">Photo crop (this post only)</span>
                <button
                  type="button"
                  onClick={() => {
                    setCrop(NO_ADJUST)
                    setZoomDraft(1)
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-slate-700"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
              {tutor?.photoHidden ? (
                <p className="text-[10px] text-gray-500">This tutor hid their photo, so the post uses a grey avatar — nothing to crop.</p>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                    Zoom
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={0.1}
                      value={zoomDraft}
                      onChange={(e) => setZoomDraft(Number(e.target.value))}
                      className="min-h-[44px] flex-1 accent-tm-navy"
                      aria-label="Zoom the photo"
                    />
                    <span className="w-8 text-right text-[10px] text-gray-500">{zoomDraft.toFixed(1)}×</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-700">Move</span>
                    {[
                      { label: 'Move up', icon: ArrowUp, dx: 0, dy: -1 },
                      { label: 'Move down', icon: ArrowDown, dx: 0, dy: 1 },
                      { label: 'Move left', icon: ArrowLeft, dx: -1, dy: 0 },
                      { label: 'Move right', icon: ArrowRight, dx: 1, dy: 0 },
                    ].map(({ label, icon: Icon, dx, dy }) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={label}
                        title={label}
                        onClick={() => move(dx, dy)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-slate-700"
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500">Not saved to the tutor&rsquo;s profile.</p>
                </>
              )}
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-gray-500">
            Posting is manual: download the image, copy the caption, publish from the TutorMint account.
          </p>
        </section>
      </div>
    </div>
  )
}
