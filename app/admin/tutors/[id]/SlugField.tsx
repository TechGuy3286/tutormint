'use client'

import { useState } from 'react'

import { adminFetch } from '@/components/admin/adminFetch'
import { slugify } from '@/lib/slugs'

// The one place a tutor's public address can be changed.
//
// SUGGEST PROPOSES, IT NEVER APPLIES. It fills the box with the canonical form
// -- name, main subject, "tutor", city -- and leaves it there for the admin to
// read, edit and save. A button that quietly rewrote a live URL on press is a
// button somebody eventually presses while scrolling.
//
// THERE IS NO "KEEP THE OLD LINK" CHECKBOX, deliberately. Saving retires the
// old address into slug_history in the same database statement that writes the
// new one, so a redirect always exists and cannot be skipped. Making it
// optional would mean offering a choice whose wrong answer breaks every link
// already in circulation.

export default function SlugField({
  tutorId,
  initialSlug,
  canEdit,
}: {
  tutorId: string
  initialSlug: string | null
  canEdit: boolean
}) {
  const [slug, setSlug] = useState(initialSlug ?? '')
  const [saved, setSaved] = useState(initialSlug ?? '')
  const [busy, setBusy] = useState<'idle' | 'suggesting' | 'saving'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const normalised = slugify(slug)
  const dirty = normalised !== saved && normalised.length > 0

  const suggest = async () => {
    setBusy('suggesting')
    setError(null)
    setMessage(null)
    const r = await adminFetch<{ slug: string | null; error?: string }>(
      `/api/admin/tutors/slug?tutorId=${encodeURIComponent(tutorId)}`,
    )
    setBusy('idle')
    if (!r.ok) return setError(r.data?.error ?? 'Could not build a suggestion.')
    if (!r.data?.slug) return setError('There is not enough on this profile to build an address.')
    setSlug(r.data.slug)
    setMessage(
      r.data.slug === saved
        ? 'The current address is already the canonical one.'
        : 'Proposed. Nothing is saved until you press Save.',
    )
  }

  const save = async () => {
    setBusy('saving')
    setError(null)
    setMessage(null)
    const r = await adminFetch<{
      slug: string
      previous: string | null
      unchanged?: boolean
      error?: string
    }>('/api/admin/tutors/slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId, slug: normalised }),
    })
    setBusy('idle')
    if (!r.ok) return setError(r.data?.error ?? 'Could not save that address.')

    const next = r.data?.slug ?? normalised
    setSlug(next)
    setSaved(next)
    setMessage(
      r.data?.unchanged
        ? 'Unchanged.'
        : r.data?.previous
          ? `Saved. /tutor/${r.data.previous} now redirects here, and the tutor has been told.`
          : 'Saved. The tutor has been told.',
    )
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
          Profile address
        </h2>
        <p className="text-[11px] leading-relaxed text-gray-500">
          A tutor moving city usually keeps their address — the page updates from the data. Change
          it only when it is genuinely wrong. Saving retires the old address and redirects it here
          automatically; there is no way to skip that.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="shrink-0 text-xs font-bold text-gray-500">/tutor/</span>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={!canEdit || busy !== 'idle'}
          spellCheck={false}
          aria-label="Profile address"
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-700 disabled:bg-tm-bg"
        />
      </div>

      {normalised !== slug && slug.length > 0 && (
        <p className="text-[11px] text-gray-500">
          Will be saved as <span className="font-bold text-tm-navy">{normalised || '—'}</span>
        </p>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={suggest}
            disabled={busy !== 'idle'}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-50"
          >
            {busy === 'suggesting' ? 'Working…' : 'Suggest'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy !== 'idle'}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-slate-700 disabled:bg-gray-300"
          >
            {busy === 'saving' ? 'Saving…' : 'Save address'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] font-semibold text-gray-500">
          Your admin role can view this but not change it.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-[11px] font-bold text-tm-red"
        >
          {error}
        </p>
      )}
      {message && !error && (
        <p className="rounded-xl border border-gray-200 bg-tm-bg p-3 text-[11px] font-semibold text-slate-700">
          {message}
        </p>
      )}
    </section>
  )
}
