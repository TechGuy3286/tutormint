'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlarmClock, CheckCircle2, FileUp, PenLine, Search, Sparkles, Wand2, X } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { clusterLabel } from '@/lib/blog'
import type { Suggestion } from '@/lib/contentQueue/feed'

// The content queue (owner, 28 Oct 2026). First: topics from real Google
// searches, tutor-side first, each with the queries behind it (impressions and
// clicks) — or "Already covered by <page>". Then the other sources. No priority
// number anywhere. "Draft this post" asks Claude for a draft and saves it as a
// DRAFT in Blog; nothing here publishes.

type RefreshItem = { id: string; title: string; slug: string; publishedAt: string }

export type SearchTopicView = {
  fingerprint: string
  title: string
  side: 'tutor' | 'parent'
  impressions: number
  clicks: number
  queries: { query: string; impressions: number; clicks: number }[]
  coveredBy: { label: string; path: string } | null
  suggestionId: string | null
  status: string | null
  draftPostId: string | null
}

type SearchSource = {
  source: 'api' | 'upload' | null
  apiFetchedAt: string | null
  uploadFetchedAt: string | null
  uploadRows: number
  access: { connected: boolean; summary: string; steps: string[]; serviceEmail: string | null }
} | null

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

export default function QueueClient({
  content,
  recruitment,
  refresh,
  searchTopics,
  searchSource,
  canDraft,
  canUpload,
}: {
  content: Suggestion[]
  recruitment: Suggestion[]
  refresh: RefreshItem[]
  searchTopics: SearchTopicView[]
  searchSource: SearchSource
  canDraft: boolean
  canUpload: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showCovered, setShowCovered] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function act(action: string, extra: Record<string, unknown>, ok: string) {
    setBusy((extra.id as string) ?? action)
    try {
      const res = await fetch('/api/admin/blog/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'That did not go through.')
        return
      }
      toast.success(ok)
      setDismissing(null)
      setReason('')
      router.refresh()
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function draft(id: string) {
    setBusy(id)
    toast.success('Claude is writing the draft. This takes about a minute.')
    try {
      const res = await fetch('/api/admin/blog/queue/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'The draft could not be written. Please try again.')
        return
      }
      toast.success(`Draft saved (${data.words} words). Opening it in Blog.`)
      router.push(data.editorPath)
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function upload(file: File) {
    if (file.size > 2_000_000) {
      toast.error('That file is too large. Export the Queries tab only.')
      return
    }
    const csv = await file.text()
    await act('upload_queries', { csv }, 'Search Console queries uploaded. The queue was rebuilt.')
  }

  const open = searchTopics.filter((t) => !t.coveredBy)
  const covered = searchTopics.filter((t) => t.coveredBy)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Content queue</h1>
          <p className="text-xs text-gray-500">What to publish next, from real searches. Rebuilt nightly; nothing publishes on its own.</p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => act('rebuild', {}, 'Queue rebuilt.')}
            disabled={busy === 'rebuild'}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
          >
            {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild now'}
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center gap-1.5">
            <Search aria-hidden size={13} className="text-tm-navy" />
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">From Google searches</h2>
          </div>
          {open.length === 0 ? (
            <Empty>
              {searchTopics.length === 0
                ? 'No search data yet. Connect Search Console or upload a Queries CSV (right).'
                : 'Every searched topic is already covered by a page or post.'}
            </Empty>
          ) : (
            open.map((t) => (
              <article key={t.fingerprint} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-tm-navy">{t.title}</h3>
                  <p className="text-[11px] font-bold text-gray-600">
                    {t.impressions.toLocaleString('en-US')} search{t.impressions === 1 ? '' : 'es'} last month · {t.clicks} click{t.clicks === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  <Chip>{t.side === 'tutor' ? 'For tutors' : 'For parents'}</Chip>
                  {t.status === 'drafted' && <Chip>Drafted</Chip>}
                  {t.status === 'snoozed' && <Chip>Snoozed</Chip>}
                  {t.status === 'dismissed' && <Chip>Dismissed</Chip>}
                </div>
                <QueryList queries={t.queries} />
                {readOnly ? null : t.draftPostId && t.status === 'drafted' ? (
                  <Link
                    href={`/admin/blog/${t.draftPostId}`}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
                  >
                    <PenLine aria-hidden size={13} /> Open the draft
                  </Link>
                ) : !t.suggestionId ? (
                  <p className="text-[11px] text-gray-500">Press “Rebuild now” to queue this topic.</p>
                ) : t.status !== 'suggested' ? null : (
                  <TopicActions
                    id={t.suggestionId}
                    busy={busy}
                    canDraft={canDraft}
                    dismissing={dismissing}
                    reason={reason}
                    setReason={setReason}
                    setDismissing={setDismissing}
                    onDraft={draft}
                    act={act}
                  />
                )}
              </article>
            ))
          )}

          {covered.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setShowCovered((v) => !v)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:border-tm-navy"
              >
                <CheckCircle2 aria-hidden size={13} className="text-tm-green-deep" />
                Already covered ({covered.length}) {showCovered ? '— hide' : '— show'}
              </button>
              {showCovered &&
                covered.map((t) => (
                  <article key={t.fingerprint} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
                    <p className="text-xs font-bold text-tm-navy">{t.title}</p>
                    <p className="text-[11px] text-gray-600">
                      {t.impressions.toLocaleString('en-US')} search{t.impressions === 1 ? '' : 'es'} last month · Already covered by{' '}
                      <Link href={t.coveredBy!.path} target="_blank" className="font-semibold text-tm-red underline">
                        {t.coveredBy!.label}
                      </Link>
                    </p>
                    <QueryList queries={t.queries.slice(0, 4)} />
                  </article>
                ))}
            </section>
          )}

          <h2 className="pt-2 text-xs font-black uppercase tracking-wide text-gray-500">Other topics</h2>
          {content.length === 0 ? (
            <Empty>No other topics are queued right now.</Empty>
          ) : (
            content.map((s) => (
              <article key={s.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-black text-tm-navy">{s.title}</h3>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {s.cluster && <Chip>{clusterLabel(s.cluster)}</Chip>}
                  <Chip>{s.audience === 'both' ? 'Everyone' : s.audience === 'tutors' ? 'For tutors' : 'For parents'}</Chip>
                  {s.language === 'ur' && <Chip>Urdu</Chip>}
                  <Chip>{sourceLabel(s.source)}</Chip>
                </div>
                <ul className="space-y-0.5 text-[11px] text-gray-600">
                  {s.evidence.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
                {!readOnly && (
                  <TopicActions
                    id={s.id}
                    busy={busy}
                    canDraft={canDraft}
                    dismissing={dismissing}
                    reason={reason}
                    setReason={setReason}
                    setDismissing={setDismissing}
                    onDraft={draft}
                    act={act}
                  />
                )}
              </article>
            ))
          )}
        </div>

        <div className="space-y-4">
          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-1.5">
              <Sparkles aria-hidden size={13} className="text-tm-navy" />
              <h2 className="text-xs font-black text-tm-navy">Search Console</h2>
            </div>
            {searchSource?.access.connected ? (
              <p className="text-[11px] font-semibold text-tm-green-deep">
                {searchSource.access.summary} {searchSource.apiFetchedAt ? `Last read ${when(searchSource.apiFetchedAt)}.` : ''}
              </p>
            ) : (
              <>
                <p className="text-[11px] font-bold text-tm-red">{searchSource?.access.summary ?? 'Not connected.'}</p>
                {searchSource?.access.steps.length ? (
                  <ol className="list-decimal space-y-1 pl-4 text-[11px] text-gray-600">
                    {searchSource.access.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}
            <p className="text-[11px] text-gray-500">
              {searchSource?.source === 'api'
                ? 'Topics are built from the Search Console API.'
                : searchSource?.source === 'upload'
                  ? `Topics are built from the uploaded file (${searchSource.uploadRows} queries, ${when(searchSource.uploadFetchedAt)}).`
                  : 'No search data yet.'}
            </p>
            {canUpload && !readOnly && (
              <div className="space-y-1.5 border-t border-gray-100 pt-2">
                <p className="text-[11px] text-gray-600">
                  Or upload a Search Console export: Performance → Search results → Export → Download CSV, then pick <strong>Queries.csv</strong>.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void upload(f)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy === 'upload_queries'}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
                >
                  <FileUp aria-hidden size={13} /> {busy === 'upload_queries' ? 'Uploading…' : 'Upload Queries CSV'}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Recruitment gaps</h2>
            {recruitment.length === 0 ? (
              <Empty>No recruitment gaps right now.</Empty>
            ) : (
              recruitment.map((s) => (
                <article key={s.id} className="space-y-2 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3">
                  <h3 className="text-xs font-black text-tm-gold-ink">{s.title}</h3>
                  <ul className="space-y-0.5 text-[11px] text-tm-gold-ink">
                    {s.evidence.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => act('snooze', { id: s.id }, 'Snoozed.')}
                        disabled={busy === s.id}
                        className="inline-flex min-h-[40px] items-center rounded-xl border border-tm-gold/40 bg-white px-3 text-[11px] font-bold text-tm-gold-ink disabled:opacity-60"
                      >
                        Snooze
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Due a refresh</h2>
            {refresh.length === 0 ? (
              <Empty>No posts are over a year old yet.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {refresh.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/blog/${r.id}`} className="block rounded-xl border border-gray-200 bg-white p-2.5 text-[11px] font-semibold text-tm-navy hover:border-tm-navy">
                      {r.title}
                      <span className="block font-normal text-gray-500">
                        published {new Date(r.publishedAt).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi', year: 'numeric', month: 'short' })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function QueryList({ queries }: { queries: { query: string; impressions: number; clicks: number }[] }) {
  return (
    <ul className="space-y-0.5 text-[11px] text-gray-600">
      {queries.map((q) => (
        <li key={q.query}>
          • “{q.query}” — {q.impressions} impression{q.impressions === 1 ? '' : 's'}, {q.clicks} click{q.clicks === 1 ? '' : 's'}
        </li>
      ))}
    </ul>
  )
}

function TopicActions({
  id,
  busy,
  canDraft,
  dismissing,
  reason,
  setReason,
  setDismissing,
  onDraft,
  act,
}: {
  id: string
  busy: string | null
  canDraft: boolean
  dismissing: string | null
  reason: string
  setReason: (v: string) => void
  setDismissing: (v: string | null) => void
  onDraft: (id: string) => void
  act: (action: string, extra: Record<string, unknown>, ok: string) => void
}) {
  if (dismissing === id) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why dismiss this? (optional)"
          className="min-h-[40px] flex-1 rounded-lg border border-gray-200 px-2.5 text-xs text-tm-navy focus:border-tm-navy focus:outline-none"
        />
        <button
          type="button"
          onClick={() => act('dismiss', { id, reason }, 'Dismissed.')}
          disabled={busy === id}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-red px-3 text-[11px] font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissing(null)
            setReason('')
          }}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 px-3 text-[11px] font-bold text-slate-700"
        >
          Cancel
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canDraft && (
        <button
          type="button"
          onClick={() => onDraft(id)}
          disabled={busy !== null}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
        >
          <Wand2 aria-hidden size={13} /> {busy === id ? 'Writing…' : 'Draft this post'}
        </button>
      )}
      <Link
        href={`/admin/blog/new?suggestion=${id}`}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
      >
        <PenLine aria-hidden size={13} /> Write it myself
      </Link>
      <button
        type="button"
        onClick={() => act('snooze', { id }, 'Snoozed for two weeks.')}
        disabled={busy === id}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
      >
        <AlarmClock aria-hidden size={13} /> Snooze
      </button>
      <button
        type="button"
        onClick={() => setDismissing(id)}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-red hover:bg-tm-tint-red"
      >
        <X aria-hidden size={13} /> Dismiss
      </button>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-tm-bg px-2 py-0.5 text-slate-700 ring-1 ring-gray-200">{children}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-center text-[11px] text-gray-500">{children}</p>
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'search_gap':
      return 'Searches on TutorMint'
    case 'calendar':
      return 'Seasonal'
    case 'coverage_gap':
      return 'Coverage gap'
    case 'reports':
      return 'From reports'
    case 'gsc':
      return 'Google searches'
    case 'career':
      return 'Tutor career'
    default:
      return source
  }
}
