'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Eye, Lock, Pencil } from 'lucide-react'

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
  coverAlt: string | null
  seoTitle: string
  seoDescription: string
  related: string[]
  reviewed: boolean
  editedByHuman: boolean
  status: PostStatus
  publishAt: string | null
}

type LandingOption = { path: string; label: string }

export default function PostEditor({
  initial,
  landingOptions,
  canPublishCap,
}: {
  initial: EditorPost
  landingOptions: LandingOption[]
  canPublishCap: boolean
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
      coverAlt: post.coverAlt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      relatedLandingPages: post.related,
      reviewed: post.reviewed,
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
                onChange={(e) => set('title', e.target.value)}
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
                  onChange={(e) => set('slug', slugify(e.target.value))}
                  onBlur={() => !post.slug && post.title && set('slug', slugify(post.title))}
                  disabled={post.slugLocked}
                  placeholder={slugify(post.title) || 'post-slug'}
                  className={`${input} mt-0 flex-1 ${post.slugLocked ? 'bg-gray-50 text-gray-500' : ''}`}
                />
                {post.slugLocked && <Lock aria-hidden size={14} className="text-gray-500" />}
              </div>
            </div>
          </div>

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
            {showPreview ? (
              <BodyPreview segments={preview.segments} />
            ) : (
              <textarea
                id="post-body"
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
            <FileUpload
              label="Cover image"
              acceptLabel="JPG or PNG"
              currentPreview={
                coverUrl ? (
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
                set('coverPath', data.path)
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
                onChange={(e) => set('reviewed', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Reviewed — a person has read this through.
                <span className="block font-normal text-gray-500">
                  Required before publishing. Save to record it.
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
    '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-tm-black [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-slate-100'
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
