'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, AlertTriangle, CheckCircle2, Eye, Lock, Pencil, Sparkles } from 'lucide-react'

import FileUpload from '@/components/FileUpload'
import {
  AUDIENCES,
  LANGUAGES,
  POST_CLUSTERS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  canPublish,
  postPath,
  publicBlogUrl,
  statusLabel,
  type PostAudience,
  type PostLanguage,
  type PostStatus,
} from '@/lib/blog'
import { figureGate, type ConfirmedFigure } from '@/lib/ai/blogBrief'
import { parseMarkdown } from '@/lib/markdown'
import { slugify } from '@/lib/slugs'
import { SITE_URL } from '@/lib/siteUrl'

// The blog editor. One card per task, brand tokens only.
//
// THE PUBLISH GATE IS THE STORED STATE, NOT THE FORM. Publish reads the last
// SAVED post server-side (canPublish there), so the button here is enabled only
// when there are no unsaved changes AND the saved post clears the gate. That is
// why editing anything disables Publish until Save: the two must agree, and the
// server is the authority.

export type EditorPost = {
  id: string | null
  title: string
  slug: string
  slugLocked: boolean
  cluster: string
  audience: PostAudience
  language: PostLanguage
  body: string
  coverPath: string | null
  coverSquarePath: string | null
  coverAlt: string | null
  seoTitle: string
  seoDescription: string
  related: string[]
  reviewed: boolean
  editedByHuman: boolean
  status: PostStatus
  publishAt: string | null
  /** Fact notes the draft was generated from; drives the figure gate. */
  sourceNotes: string
  /** Figures the manager confirmed with a written source. */
  confirmedFigures: ConfirmedFigure[]
}

type LandingOption = { path: string; label: string }

export default function PostEditor({
  initial,
  landingOptions,
  canPublishCap,
  canGenerate,
  suggestionId = null,
}: {
  initial: EditorPost
  landingOptions: LandingOption[]
  canPublishCap: boolean
  /** Owner + manager: may call the Claude API to draft. */
  canGenerate: boolean
  /** The content-queue suggestion this editor was opened from, if any. */
  suggestionId?: string | null
}) {
  const router = useRouter()

  const [post, setPost] = useState<EditorPost>(initial)
  // The last-saved snapshot the publish gate is judged against.
  const saved = useRef<EditorPost>(initial)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genNote, setGenNote] = useState<string | null>(null)
  // The in-progress "confirm with a source" input, keyed by figure.
  const [confirmDraft, setConfirmDraft] = useState<Record<string, string>>({})
  // The body textarea, for the toolbar to insert Markdown at the cursor.
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // Whether the slug has been hand-edited. Until it is, the slug tracks the
  // title as it is typed (and it is locked after publishing either way).
  const [slugEdited, setSlugEdited] = useState(!!initial.slug)

  const set = <K extends keyof EditorPost>(key: K, value: EditorPost[K]) => {
    setPost((p) => ({ ...p, [key]: value }))
    setDirty(true)
    setNotice(null)
  }

  const toggleRelated = (path: string) => {
    setPost((p) => ({
      ...p,
      related: p.related.includes(path) ? p.related.filter((x) => x !== path) : [...p.related, path],
    }))
    setDirty(true)
  }

  const preview = useMemo(() => parseMarkdown(post.body), [post.body])

  // The figure gate, computed live from the current (unsaved) body — the same
  // rule the server enforces on save. Active only when there are notes; then
  // every number in the body must trace to them or be confirmed with a source.
  const figures = useMemo(
    () =>
      figureGate(
        post.body,
        post.sourceNotes,
        post.title,
        post.confirmedFigures.map((c) => c.figure),
        landingOptions,
      ),
    [post.body, post.sourceNotes, post.title, post.confirmedFigures, landingOptions],
  )
  const figureBlocked = figures.active && figures.untraced.length > 0

  const gate = canPublish({
    title: saved.current.title,
    slug: saved.current.slug,
    body: saved.current.body,
    coverPath: saved.current.coverPath,
    coverAlt: saved.current.coverAlt,
    editedByHuman: saved.current.editedByHuman,
    reviewed: saved.current.reviewed,
  })
  const publishable = canPublishCap && !dirty && gate.ok && !!post.id
  const isLive = saved.current.status === 'published' || saved.current.status === 'scheduled'

  async function post_(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/blog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That did not go through.')
        return null
      }
      return data
    } catch {
      setError('Network error. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  // Generate a draft from the title + notes. Loads the body and SEO fields as
  // ordinary editable text — it saves nothing and never ticks Reviewed.
  async function generateDraft() {
    if (!post.title.trim()) {
      setError('Give the post a title first.')
      return
    }
    setGenerating(true)
    setError(null)
    setNotice(null)
    setGenNote(null)
    try {
      const res = await fetch('/api/admin/blog/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: post.title,
          cluster: post.cluster,
          audience: post.audience,
          language: post.language,
          notes: post.sourceNotes,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not generate a draft.')
        return
      }
      setPost((p) => ({
        ...p,
        body: data.body,
        seoTitle: data.seoTitle || p.seoTitle,
        seoDescription: data.seoDescription || p.seoDescription,
        // A fresh draft supersedes prior confirmations — its figures are new.
        confirmedFigures: [],
      }))
      setDirty(true)
      if (data.source === 'claude') {
        setGenNote(
          data.untraced?.length
            ? `Draft ready — but ${data.untraced.length} figure(s) are not in your notes. Check the highlighted list before reviewing.`
            : 'Draft ready. Read it through, edit, then tick Reviewed.',
        )
      } else {
        // The real reason, in plain words. `reason` is the verbatim API failure
        // (status + body); we compose from the notes so the editor stays usable.
        const why =
          data.note === 'unconfigured'
            ? 'no API key is configured'
            : (data.reason as string | null) || 'the model did not respond'
        setGenNote(`AI drafting is unavailable: ${why}. We composed this draft from your notes instead — edit it into shape.`)
      }
    } catch {
      setError('Network error while generating. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  // Generate a cover from the title + cluster, at both sizes.
  async function generateCover() {
    if (!post.title.trim()) {
      setError('Give the post a title first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/blog/generate-cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: post.title, cluster: post.cluster }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not generate a cover.')
        return
      }
      setPost((p) => ({
        ...p,
        coverPath: data.coverPath,
        coverSquarePath: data.coverSquarePath,
        // Alt for a generated cover is derived server-side; keep any hand-typed
        // alt the manager already wrote.
        coverAlt: p.coverAlt?.trim() ? p.coverAlt : data.coverAlt,
      }))
      setDirty(true)
      setNotice('Cover generated at both sizes. Save to keep it.')
    } catch {
      setError('Network error while generating the cover.')
    } finally {
      setBusy(false)
    }
  }

  // Insert Markdown at the cursor (or wrap the selection). Keeps focus and puts
  // the caret where the writer will keep typing, so the toolbar is usable
  // without touching the mouse twice.
  function insertMarkdown(before: string, after = '', placeholder = '') {
    const el = bodyRef.current
    const value = post.body
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    setPost((p) => ({ ...p, body: next }))
    setDirty(true)
    // Restore focus and place the caret inside the inserted text.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const caret = start + before.length
      el.setSelectionRange(caret, caret + selected.length)
    })
  }

  function confirmFigure(figure: string) {
    const source = (confirmDraft[figure] ?? '').trim()
    if (!source) return
    setPost((p) => ({
      ...p,
      confirmedFigures: [
        ...p.confirmedFigures.filter((c) => c.figure !== figure),
        { figure, source },
      ],
    }))
    setConfirmDraft((d) => {
      const next = { ...d }
      delete next[figure]
      return next
    })
    setDirty(true)
  }

  async function save() {
    const data = await post_('save', {
      id: post.id ?? undefined,
      title: post.title,
      slug: post.slugLocked ? undefined : post.slug || slugify(post.title),
      cluster: post.cluster,
      audience: post.audience,
      language: post.language,
      body: post.body,
      coverPath: post.coverPath,
      coverSquarePath: post.coverSquarePath,
      coverAlt: post.coverAlt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      relatedLandingPages: post.related,
      reviewed: post.reviewed,
      sourceNotes: post.sourceNotes,
      confirmedFigures: post.confirmedFigures,
      // Only meaningful on the first save; the route ignores it once the post
      // exists (it marks the suggestion drafted in the insert branch).
      suggestionId: !post.id ? suggestionId ?? undefined : undefined,
    })
    if (!data) return
    const next: EditorPost = {
      ...post,
      id: data.id,
      slug: data.slug ?? post.slug,
      status: data.status ?? post.status,
      editedByHuman: true,
    }
    setPost(next)
    saved.current = next
    setDirty(false)
    setNotice('Saved.')
    if (!initial.id && data.id) {
      // A brand-new post now has a URL — move to it so a refresh keeps the id.
      router.replace(`/admin/blog/${data.id}`)
    }
    router.refresh()
  }

  async function doPublish() {
    if (!post.id) return
    const data = await post_('publish', { id: post.id })
    if (!data) return
    const next = { ...post, status: 'published' as PostStatus, slugLocked: true }
    setPost(next)
    saved.current = next
    setNotice('Published. It is live now.')
    router.refresh()
  }

  async function doSchedule() {
    if (!post.id || !scheduleAt) {
      setError('Pick a date and time to schedule.')
      return
    }
    const data = await post_('schedule', { id: post.id, publishAt: new Date(scheduleAt).toISOString() })
    if (!data) return
    const next = { ...post, status: 'scheduled' as PostStatus, slugLocked: true }
    setPost(next)
    saved.current = next
    setNotice('Scheduled.')
    router.refresh()
  }

  async function doUnpublish() {
    if (!post.id) return
    const data = await post_('unpublish', { id: post.id })
    if (!data) return
    const next = { ...post, status: 'unpublished' as PostStatus }
    setPost(next)
    saved.current = next
    setNotice('Unpublished. The page now shows a friendly notice with a link to the blog.')
    router.refresh()
  }

  async function doDelete() {
    if (!post.id) return
    if (!window.confirm('Delete this post permanently? This cannot be undone.')) return
    const data = await post_('delete', { id: post.id })
    if (!data) return
    router.replace('/admin/blog')
  }

  const label = 'block text-xs font-bold text-tm-navy'
  const input =
    'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-tm-navy placeholder:text-gray-500 focus:border-tm-navy focus:outline-none'
  const card = 'rounded-2xl border border-gray-200 bg-white p-4 space-y-3'

  const coverUrl = post.coverPath ? publicBlogUrl(post.coverPath) : null

  return (
    <div className="space-y-4">
      {/* Status + primary actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy">
          {statusLabel(post.status)}
        </span>
        {dirty && <span className="text-[11px] font-semibold text-tm-gold-ink">Unsaved changes</span>}
        {post.status === 'published' && (
          <a
            href={postPath(post.slug)}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-tm-red hover:underline"
          >
            View live ↗
          </a>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !post.title.trim()}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {canPublishCap && post.status !== 'published' && (
            <button
              type="button"
              onClick={doPublish}
              disabled={busy || !publishable}
              title={!publishable ? gate.reasons[0] ?? 'Save your changes first.' : undefined}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
            >
              Publish
            </button>
          )}
          {canPublishCap && isLive && (
            <button
              type="button"
              onClick={doUnpublish}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
            >
              Unpublish
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-xl bg-tm-tint-red p-3 text-xs font-semibold text-tm-red-hover">
          <AlertCircle aria-hidden size={14} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-1.5 rounded-xl bg-tm-tint-green p-3 text-xs font-semibold text-tm-green-deep">
          <CheckCircle2 aria-hidden size={14} className="mt-px shrink-0" /> {notice}
        </p>
      )}

      {/* Publish checklist, when it is not yet publishable */}
      {canPublishCap && post.status !== 'published' && !publishable && (
        <div className="rounded-2xl border border-gray-200 bg-tm-bg p-4">
          <p className="text-xs font-bold text-tm-navy">Before publishing</p>
          <ul className="mt-1.5 space-y-1 text-xs text-gray-600">
            {dirty && <li>• Save your changes first.</li>}
            {gate.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Title + slug */}
          <div className={card}>
            <div>
              <label htmlFor="post-title" className={label}>
                Title
              </label>
              <input
                id="post-title"
                value={post.title}
                onChange={(e) => {
                  const title = e.target.value
                  // The slug tracks the title as it is typed, until the slug is
                  // hand-edited or the post is published (slug then locked).
                  setPost((p) => ({
                    ...p,
                    title,
                    slug: !p.slugLocked && !slugEdited ? slugify(title) : p.slug,
                  }))
                  setDirty(true)
                  setNotice(null)
                }}
                placeholder="What is this post about?"
                className={input}
              />
            </div>
            <div>
              <label htmlFor="post-slug" className={label}>
                Slug {post.slugLocked && <span className="font-normal text-gray-500">(locked after publishing)</span>}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-gray-500">/blog/</span>
                <input
                  id="post-slug"
                  value={post.slug}
                  onChange={(e) => {
                    setSlugEdited(true)
                    set('slug', slugify(e.target.value))
                  }}
                  onBlur={() => {
                    // An emptied slug falls back to tracking the title again.
                    if (!post.slug) {
                      setSlugEdited(false)
                      if (post.title) set('slug', slugify(post.title))
                    }
                  }}
                  disabled={post.slugLocked}
                  placeholder={slugify(post.title) || 'post-slug'}
                  className={`${input} mt-0 flex-1 ${post.slugLocked ? 'bg-gray-50 text-gray-500' : ''}`}
                />
                {post.slugLocked && <Lock aria-hidden size={14} className="text-gray-500" />}
              </div>
            </div>
          </div>

          {/* Draft with AI — owner + manager only. Saves nothing; loads the
              body and SEO fields for the human to edit and review. */}
          {canGenerate && (
            <div className={card}>
              <div className="flex items-center gap-1.5">
                <Sparkles aria-hidden size={14} className="text-tm-navy" />
                <p className={label}>Draft with AI</p>
              </div>
              <div>
                <label htmlFor="ai-notes" className="text-[11px] font-semibold text-gray-600">
                  Fact notes <span className="font-normal">(3–5 lines: local numbers, a name, a story)</span>
                </label>
                <textarea
                  id="ai-notes"
                  value={post.sourceNotes}
                  onChange={(e) => set('sourceNotes', e.target.value)}
                  rows={4}
                  placeholder={
                    'O Level Physics fees in Lahore are typically Rs 8,000–15,000 a month\nMost parents want in-person tutoring in DHA and Gulberg\nExam boards: Cambridge and Edexcel'
                  }
                  className={`${input} text-xs`}
                  dir={post.language === 'ur' ? 'rtl' : undefined}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={generateDraft}
                  disabled={generating || !post.title.trim()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
                >
                  <Sparkles aria-hidden size={13} />
                  {generating ? 'Writing…' : 'Generate draft'}
                </button>
                <span className="text-[11px] text-gray-500">
                  Every figure must trace to your notes. A few rupees per draft.
                </span>
              </div>
              {genNote && (
                <p className="rounded-xl bg-tm-tint-navy p-2.5 text-[11px] font-semibold text-tm-navy">{genNote}</p>
              )}
            </div>
          )}

          {/* Body + live preview */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <label htmlFor="post-body" className={label}>
                Body <span className="font-normal text-gray-500">(Markdown)</span>
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-tm-navy hover:underline"
              >
                {showPreview ? <Pencil aria-hidden size={12} /> : <Eye aria-hidden size={12} />}
                {showPreview ? 'Write' : 'Preview'}
              </button>
            </div>
            {/* Formatting toolbar — inserts Markdown at the cursor, so a writer
                who has never seen Markdown can still format a post. Hidden in
                Preview, where there is nothing to insert into. */}
            {!showPreview && (
              <div className="flex flex-wrap gap-1">
                {[
                  { label: 'H2', title: 'Heading', run: () => insertMarkdown('\n## ', '', 'Heading') },
                  { label: 'B', title: 'Bold', run: () => insertMarkdown('**', '**', 'bold'), bold: true },
                  { label: 'I', title: 'Italic', run: () => insertMarkdown('_', '_', 'italic'), italic: true },
                  { label: 'List', title: 'Bulleted list', run: () => insertMarkdown('\n- ', '', 'item') },
                  { label: 'Link', title: 'Link', run: () => insertMarkdown('[', '](https://)', 'text') },
                  { label: 'Image', title: 'Image', run: () => insertMarkdown('![', '](https://)', 'alt text') },
                  { label: 'Tutor', title: 'Embed a tutor card', run: () => insertMarkdown('\n{{tutor:', '}}\n', 'tutor-slug') },
                  { label: 'Tuition', title: 'Embed a tuition card', run: () => insertMarkdown('\n{{job:', '}}\n', 'tuition-slug') },
                ].map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    title={b.title}
                    aria-label={b.title}
                    onClick={b.run}
                    className={`min-h-[36px] min-w-[36px] rounded-lg border border-gray-200 px-2 text-xs text-tm-navy hover:border-tm-navy hover:bg-tm-bg ${
                      b.bold ? 'font-black' : b.italic ? 'italic' : 'font-bold'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {showPreview ? (
              <BodyPreview segments={preview.segments} />
            ) : (
              <textarea
                id="post-body"
                ref={bodyRef}
                value={post.body}
                onChange={(e) => set('body', e.target.value)}
                rows={18}
                placeholder={'## A heading\n\nWrite in Markdown. Embed a card with {{tutor:slug}} or {{job:public-slug}} on its own line.'}
                className={`${input} font-mono text-xs leading-relaxed`}
                dir={post.language === 'ur' ? 'rtl' : undefined}
              />
            )}
            <p className="text-[11px] text-gray-500">
              {preview.readingTime} min read · Embed a live card with <code className="rounded bg-tm-tint-navy px-1">{'{{tutor:slug}}'}</code> or{' '}
              <code className="rounded bg-tm-tint-navy px-1">{'{{job:public-slug}}'}</code> on its own line.
            </p>
          </div>

          {/* Figure gate — every number in the body must trace to the notes.
              Blocks Reviewed until each flagged figure is edited out or
              confirmed with a source. Shown only when there are notes. */}
          {figureBlocked && (
            <div className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4">
              <div className="flex items-start gap-1.5">
                <AlertTriangle aria-hidden size={15} className="mt-px shrink-0 text-tm-gold-ink" />
                <div>
                  <p className="text-xs font-black text-tm-gold-ink">
                    {figures.untraced.length} figure{figures.untraced.length === 1 ? '' : 's'} not in your notes
                  </p>
                  <p className="text-[11px] text-tm-gold-ink">
                    Edit each out of the body, add it to your notes, or confirm it with a source.
                    You cannot mark this Reviewed until they are cleared.
                  </p>
                </div>
              </div>
              <ul className="mt-3 space-y-2">
                {figures.untraced.map((f) => (
                  <li key={f} className="rounded-xl bg-white p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-tm-tint-red px-1.5 py-0.5 text-[11px] font-black text-tm-red">
                        {f}
                      </code>
                      <span className="text-[11px] text-gray-500">not in your notes</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input
                        value={confirmDraft[f] ?? ''}
                        onChange={(e) => setConfirmDraft((d) => ({ ...d, [f]: e.target.value }))}
                        placeholder="Source for this figure…"
                        className="min-h-[40px] flex-1 rounded-lg border border-gray-200 px-2.5 text-xs text-tm-navy focus:border-tm-navy focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => confirmFigure(f)}
                        disabled={!(confirmDraft[f] ?? '').trim()}
                        className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {post.confirmedFigures.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-3">
              <p className="text-[11px] font-bold text-tm-navy">Confirmed figures</p>
              <ul className="mt-1.5 space-y-1">
                {post.confirmedFigures.map((c) => (
                  <li key={c.figure} className="flex items-start gap-2 text-[11px] text-gray-600">
                    <code className="rounded bg-tm-tint-green px-1.5 py-0.5 font-black text-tm-green-deep">
                      {c.figure}
                    </code>
                    <span className="min-w-0 flex-1">{c.source}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPost((p) => ({
                          ...p,
                          confirmedFigures: p.confirmedFigures.filter((x) => x.figure !== c.figure),
                        }))
                        setDirty(true)
                      }}
                      className="shrink-0 text-tm-red hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* SEO */}
          <div className={card}>
            <p className={label}>Search appearance</p>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="seo-title" className="text-[11px] font-semibold text-gray-600">
                  SEO title
                </label>
                <Counter value={post.seoTitle} max={SEO_TITLE_MAX} />
              </div>
              <input
                id="seo-title"
                value={post.seoTitle}
                onChange={(e) => set('seoTitle', e.target.value)}
                placeholder={post.title}
                className={input}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="seo-desc" className="text-[11px] font-semibold text-gray-600">
                  Meta description
                </label>
                <Counter value={post.seoDescription} max={SEO_DESCRIPTION_MAX} />
              </div>
              <textarea
                id="seo-desc"
                value={post.seoDescription}
                onChange={(e) => set('seoDescription', e.target.value)}
                rows={2}
                className={input}
              />
            </div>
            {/* Google-style preview */}
            <div className="rounded-xl border border-gray-200 bg-tm-bg p-3">
              <p className="truncate text-[11px] text-gray-500">
                {SITE_URL.replace(/^https?:\/\//, '')} › blog › {post.slug || slugify(post.title) || 'post'}
              </p>
              <p className="truncate text-sm font-semibold text-tm-navy">
                {post.seoTitle.trim() || post.title || 'Post title'}
              </p>
              <p className="line-clamp-2 text-xs text-gray-600">
                {post.seoDescription.trim() || 'A short description shows here in search results.'}
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar: settings, cover, review, schedule, danger */}
        <div className="space-y-4">
          <div className={card}>
            <div>
              <label htmlFor="post-cluster" className={label}>
                Topic cluster
              </label>
              <select id="post-cluster" value={post.cluster} onChange={(e) => set('cluster', e.target.value)} className={input}>
                {POST_CLUSTERS.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="post-audience" className={label}>
                Audience
              </label>
              <select
                id="post-audience"
                value={post.audience}
                onChange={(e) => set('audience', e.target.value as PostAudience)}
                className={input}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="post-language" className={label}>
                Language
              </label>
              <select
                id="post-language"
                value={post.language}
                onChange={(e) => set('language', e.target.value as PostLanguage)}
                className={input}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cover */}
          <div className={card}>
            <p className={label}>Cover image</p>
            {/* Generate a branded cover from the title + cluster, at both sizes,
                or upload one below. A generated cover derives its own alt text. */}
            <button
              type="button"
              onClick={generateCover}
              disabled={busy || !post.title.trim()}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
            >
              <Sparkles aria-hidden size={13} />
              Generate cover
            </button>
            {post.coverSquarePath && (
              <div className="grid grid-cols-2 gap-2">
                <figure className="space-y-1">
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicBlogUrl(post.coverPath!)} alt="" className="aspect-[1200/630] w-full object-cover" />
                  </div>
                  <figcaption className="text-[10px] font-semibold text-gray-500">Post · 1200×630</figcaption>
                </figure>
                <figure className="space-y-1">
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicBlogUrl(post.coverSquarePath)} alt="" className="aspect-square w-full object-cover" />
                  </div>
                  <figcaption className="text-[10px] font-semibold text-gray-500">Social · 1080×1080</figcaption>
                </figure>
              </div>
            )}
            <p className="text-[11px] text-gray-500">or upload your own:</p>
            <FileUpload
              label="Cover image"
              acceptLabel="JPG or PNG"
              currentPreview={
                coverUrl && !post.coverSquarePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                ) : undefined
              }
              onFile={async (file) => {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/admin/blog/cover', { method: 'POST', body: fd })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error ?? 'Upload failed.')
                // An uploaded cover replaces the generated pair; drop the square
                // variant so the previews reflect what is actually set.
                setPost((p) => ({ ...p, coverPath: data.path, coverSquarePath: null }))
                setDirty(true)
              }}
            />
            <div>
              <label htmlFor="cover-alt" className="text-[11px] font-semibold text-gray-600">
                Alt text {post.coverPath && <span className="text-tm-red">(required)</span>}
              </label>
              <input
                id="cover-alt"
                value={post.coverAlt ?? ''}
                onChange={(e) => set('coverAlt', e.target.value)}
                placeholder="Describe the image"
                className={input}
              />
            </div>
          </div>

          {/* Related landing pages */}
          <div className={card}>
            <p className={label}>Related landing pages</p>
            {landingOptions.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                No city × subject landing pages are live yet. They appear here once a combination has
                enough listed tutors or open tuitions.
              </p>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {landingOptions.map((o) => (
                  <label key={o.path} className="flex items-start gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={post.related.includes(o.path)}
                      onChange={() => toggleRelated(o.path)}
                      className="mt-0.5"
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Review + schedule + delete */}
          <div className={card}>
            <label className="flex items-start gap-2 text-xs font-semibold text-tm-navy">
              <input
                type="checkbox"
                checked={post.reviewed}
                // Ticking Reviewed is blocked while figures are untraced — the
                // same gate the server enforces on save.
                disabled={figureBlocked && !post.reviewed}
                onChange={(e) => {
                  if (e.target.checked && figureBlocked) {
                    setError('Clear the flagged figures before marking this Reviewed.')
                    return
                  }
                  set('reviewed', e.target.checked)
                }}
                className="mt-0.5"
              />
              <span>
                Reviewed — a person has read this through.
                <span className="block font-normal text-gray-500">
                  {figureBlocked
                    ? 'Blocked: clear the flagged figures above first.'
                    : 'Required before publishing. Save to record it.'}
                </span>
              </span>
            </label>

            {canPublishCap && post.status !== 'published' && (
              <div className="border-t border-gray-100 pt-3">
                <label htmlFor="schedule-at" className="text-[11px] font-semibold text-gray-600">
                  Schedule for later
                </label>
                <input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className={input}
                />
                <button
                  type="button"
                  onClick={doSchedule}
                  disabled={busy || !publishable || !scheduleAt}
                  title={!publishable ? 'Save and clear the publish checklist first.' : undefined}
                  className="mt-2 inline-flex min-h-[40px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
                >
                  Schedule
                </button>
              </div>
            )}

            {canPublishCap && post.id && (
              <div className="border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={busy}
                  className="text-[11px] font-bold text-tm-red hover:underline disabled:opacity-60"
                >
                  Delete this post
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.trim().length
  const over = n > max
  return (
    <span className={`text-[10px] font-bold ${over ? 'text-tm-red' : 'text-gray-500'}`}>
      {n}/{max}
    </span>
  )
}

// A read-only render of the body for the editor's Preview toggle. Embeds show a
// placeholder rather than fetching live cards — the point here is to check the
// prose, and the live cards render on the published page.
function BodyPreview({ segments }: { segments: ReturnType<typeof parseMarkdown>['segments'] }) {
  const PROSE =
    'max-w-none rounded-xl border border-gray-200 bg-tm-bg p-4 text-sm leading-relaxed text-slate-700 ' +
    '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-black [&_h2]:text-tm-navy ' +
    '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-black [&_h3]:text-tm-navy ' +
    '[&_p]:my-2 [&_a]:font-semibold [&_a]:text-tm-red [&_a]:underline [&_strong]:font-bold [&_strong]:text-tm-navy ' +
    '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 ' +
    '[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-tm-navy/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 ' +
    '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-tm-black [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-slate-100 ' +
    '[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs ' +
    '[&_th]:border [&_th]:border-gray-200 [&_th]:bg-tm-tint-navy [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-tm-navy ' +
    '[&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top'
  return (
    <div className={PROSE}>
      {segments.map((seg, i) =>
        seg.kind === 'html' ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <div key={i} className="my-3 rounded-xl border border-dashed border-gray-300 bg-white p-3 text-center text-[11px] font-semibold text-gray-500">
            {seg.embed.type === 'tutor' ? 'Tutor card' : 'Tuition card'}: {seg.embed.slug}
          </div>
        ),
      )}
    </div>
  )
}
