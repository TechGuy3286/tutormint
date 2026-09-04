'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlarmClock, PenLine, Sparkles, Upload, X } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { clusterLabel } from '@/lib/blog'
import type { Suggestion } from '@/lib/contentQueue/feed'

// The content queue, in cards. Content topics on the left, recruitment gaps and
// the Search Console status on the right. Every card explains its priority from
// the stored components — never a bare number — and its evidence in plain words.

type RefreshItem = { id: string; title: string; slug: string; publishedAt: string }

export default function QueueClient({
  content,
  recruitment,
  refresh,
  gsc,
}: {
  content: Suggestion[]
  recruitment: Suggestion[]
  refresh: RefreshItem[]
  gsc: { connected: boolean; steps: string[] }
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  async function act(action: string, extra: Record<string, unknown>, ok: string) {
    setBusy((extra.id as string) ?? action)
    try {
      const res = await fetch('/api/admin/blog/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'That did not go through.')
        return
      }
      toast.success(ok)
      setDismissing(null)
      setReason('')
      router.refresh()
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Content queue</h1>
          <p className="text-xs text-gray-500">
            What to publish next, from live site data. Rebuilt nightly; nothing publishes on its own.
          </p>
        </div>
        <button
          type="button"
          onClick={() => act('rebuild', {}, 'Queue rebuilt.')}
          disabled={busy === 'rebuild'}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
        >
          {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild now'}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Content topics */}
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Topics to publish</h2>
          {content.length === 0 ? (
            <Empty>No topics are queued right now. They appear as searches, seasons and coverage gaps build up.</Empty>
          ) : (
            content.map((s) => (
              <article key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-black text-tm-navy">{s.title}</h3>
                  <Priority s={s} />
                </div>

                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {s.cluster && <Chip>{clusterLabel(s.cluster)}</Chip>}
                  <Chip>{s.audience === 'both' ? 'Everyone' : s.audience}</Chip>
                  {s.language === 'ur' && <Chip>Urdu</Chip>}
                  <Chip>{sourceLabel(s.source)}</Chip>
                </div>

                <ul className="space-y-0.5 text-[11px] text-gray-600">
                  {s.evidence.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>

                {dismissing === s.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why dismiss this? (optional)"
                      className="min-h-[40px] flex-1 rounded-lg border border-gray-200 px-2.5 text-xs text-tm-navy focus:border-tm-navy focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => act('dismiss', { id: s.id, reason }, 'Dismissed.')}
                      disabled={busy === s.id}
                      className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-red px-3 text-[11px] font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDismissing(null); setReason('') }}
                      className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 px-3 text-[11px] font-bold text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/blog/new?suggestion=${s.id}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
                    >
                      <PenLine aria-hidden size={13} /> Draft this
                    </Link>
                    <button
                      type="button"
                      onClick={() => act('snooze', { id: s.id }, 'Snoozed for two weeks.')}
                      disabled={busy === s.id}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
                    >
                      <AlarmClock aria-hidden size={13} /> Snooze
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissing(s.id)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-red hover:bg-tm-tint-red"
                    >
                      <X aria-hidden size={13} /> Dismiss
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        {/* Sidebar: recruitment gaps, refresh, GSC */}
        <div className="space-y-4">
          <section className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Recruitment gaps</h2>
            {recruitment.length === 0 ? (
              <Empty>No recruitment gaps right now.</Empty>
            ) : (
              recruitment.map((s) => (
                <article key={s.id} className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3 space-y-2">
                  <h3 className="text-xs font-black text-tm-gold-ink">{s.title}</h3>
                  <ul className="space-y-0.5 text-[11px] text-tm-gold-ink">
                    {s.evidence.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/admin/import"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-navy px-3 text-[11px] font-bold text-white hover:bg-tm-navy-hover"
                    >
                      <Upload aria-hidden size={12} /> Bulk import
                    </Link>
                    <button
                      type="button"
                      onClick={() => act('snooze', { id: s.id }, 'Snoozed.')}
                      disabled={busy === s.id}
                      className="inline-flex min-h-[40px] items-center rounded-xl border border-tm-gold/40 bg-white px-3 text-[11px] font-bold text-tm-gold-ink disabled:opacity-60"
                    >
                      Snooze
                    </button>
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
                    <Link
                      href={`/admin/blog/${r.id}`}
                      className="block rounded-xl border border-gray-200 bg-white p-2.5 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
                    >
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

          <section className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Sparkles aria-hidden size={13} className="text-tm-navy" />
              <h2 className="text-xs font-black text-tm-navy">Search Console</h2>
            </div>
            {gsc.connected ? (
              <p className="text-[11px] font-semibold text-tm-green-deep">
                Connected. Positions 8–20 feed the queue on the next rebuild.
              </p>
            ) : (
              <>
                <p className="text-[11px] font-bold text-gray-500">Not connected.</p>
                <ol className="list-decimal space-y-1 pl-4 text-[11px] text-gray-600">
                  {gsc.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Priority({ s }: { s: Suggestion }) {
  const c = s.components
  return (
    <div className="shrink-0 text-right">
      <div className="rounded-lg bg-tm-tint-navy px-2 py-0.5 text-xs font-black text-tm-navy">{s.priority}</div>
      <div className="mt-0.5 text-[9px] leading-tight text-gray-500">
        {c.demand}·{c.rankProximity}×{c.seasonality}×{c.gapAge}
      </div>
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
      return 'Search demand'
    case 'calendar':
      return 'Seasonal'
    case 'coverage_gap':
      return 'Coverage gap'
    case 'reports':
      return 'From reports'
    case 'gsc':
      return 'Search Console'
    default:
      return source
  }
}
