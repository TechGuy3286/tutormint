'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import ThreeWayReview, { type ReviewLabels } from '@/components/admin/ThreeWayReview'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { CONFIDENCE_LABEL, NOT_AREA_REASONS, suggestionLine } from '@/lib/locationCleanCore'
import { runBatches, type BatchOutcome } from '@/lib/batchRunCore'
import type { ReviewAction, ReviewRow } from '@/lib/locationReview'
import { REVIEW_KIND_LABEL, reviewCountsView } from '@/lib/locationCountsCore'

// Admin → Locations → "Typed by tutors and parents" (owner, 13 + 16 Oct 2026;
// 28 Oct 2026: 25 rows at a time, the clean-up buckets — a pre-filled
// suggestion with one-click Approve, "Approve all suggestions (N)", "Add as
// new area", "Not an area").
//
// One page of rows at a time from GET /api/admin/locations — the suggestions
// are computed on the server, so the screen never waits on the whole list.
// Each row can be approved as suggested or edited first (another area, another
// name, another reason). Bulk approval is ONE KIND at a time, always confirmed
// with the count and a sample of 5, and sent in batches of 20 with a progress
// bar; a failed batch never stops the rest. Approving is the Owner's: other
// roles see the rows and no buttons, and the server refuses them (403).

const LABELS: ReviewLabels = {
  add: 'Add as new area',
  same: 'Same as existing area',
  ignore: 'Not an area',
  nameLabel: 'Area name',
  findPlaceholder: 'Find an area in this city',
}

const CHIP: Record<string, string> = {
  high: 'bg-tm-tint-green text-tm-green-deep',
  medium: 'bg-tm-tint-gold text-tm-gold-ink',
  low: 'bg-tm-tint-navy text-tm-navy',
}

type Kind = 'all' | 'same' | 'not_area' | 'add'
type Counts = { same: number; notArea: number; add: number; aliases: number; ignored: number }
type Page = { rows: ReviewRow[]; total: number; counts: Counts; areasByCity: Record<string, { id: number; name: string }[]> }

const KIND_LABEL = REVIEW_KIND_LABEL
const BATCH = 20

type ItemResult = { value: string; ok: boolean; message: string }

export default function LocationsReviewClient({ initialCounts }: { initialCounts: Counts }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const canApprove = useCanApprove()
  const [kind, setKind] = useState<Kind>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [extra, setExtra] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Counts>(initialCounts)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [outcome, setOutcome] = useState<{ label: string; done: number; failed: { value: string; city: string; error: string }[] } | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  // A fresh page render (router.refresh) brings fresh counts too.
  useEffect(() => setCounts(initialCounts), [initialCounts])

  const load = useCallback(
    async (offset: number) => {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({ kind, q: q.trim(), offset: String(offset) })
      const { ok, data } = await adminFetch<Page & { error?: string }>(`/api/admin/locations?${params}`)
      setLoading(false)
      if (!ok || !data?.rows) {
        setError(data?.error ?? 'The list did not load. Please try again.')
        return
      }
      setCounts(data.counts)
      if (offset === 0) {
        setPage(data)
        setExtra([])
      } else {
        setExtra((cur) => [...cur, ...data.rows])
        setPage((p) => (p ? { ...p, areasByCity: { ...p.areasByCity, ...data.areasByCity } } : data))
      }
    },
    [kind, q],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const rows = [...(page?.rows ?? []), ...extra].filter((r) => !gone.has(r.key))
  const areasOf = (city: string) => page?.areasByCity[city.trim().toLowerCase()] ?? []

  /** POST one batch; per item, true or the reason it did not save. */
  const postBatch = async (items: ReviewAction[]): Promise<(true | string)[]> => {
    const { ok, data } = await adminFetch<{ error?: string; results?: ItemResult[] }>('/api/admin/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    if (data?.results && data.results.length === items.length) return data.results.map((r) => (r.ok ? true : r.message))
    throw new Error(data?.error ?? (ok ? 'Not saved.' : 'That batch did not go through.'))
  }

  const keyOf = (a: ReviewAction) => `${a.city.trim().toLowerCase()}|${a.value.trim().toLowerCase()}`

  const one = async (item: ReviewAction) => {
    setBusy(true)
    try {
      const [r] = await postBatch([item])
      if (r === true) {
        setGone((g) => new Set(g).add(keyOf(item)))
        toast.success('Saved.')
        router.refresh()
        // Re-read the list AND its counts, so the heading, chips and bulk
        // buttons all show the same fresh numbers.
        void load(0)
      } else toast.error(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const bulk = async (k: Exclude<Kind, 'all'>) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ items?: ReviewAction[]; sample?: { value: string; city: string; line: string }[]; skipped?: number; error?: string }>(
      `/api/admin/locations?kind=${k}&bulk=1`,
    )
    setBusy(false)
    if (!ok || !data?.items) {
      toast.error(data?.error ?? 'The list did not load. Please try again.')
      return
    }
    const items = data.items
    if (items.length === 0) {
      toast.error('Nothing of this kind can be approved as it is. Use the buttons on each row.')
      return
    }
    const sample = (data.sample ?? []).map((s) => `• “${s.value}” (${s.city || 'no city'}) → ${s.line}`).join('\n')
    const warn = k === 'add' ? '\n\nEach row ADDS A NEW AREA to the list. Check the sample carefully.' : ''
    const yes = await confirm({
      title: `Approve all “${KIND_LABEL[k]}” (${items.length})?`,
      body: `This changes ${items.length} row${items.length === 1 ? '' : 's'}${data.skipped ? ` (${data.skipped} more cannot be saved as suggested and are left)` : ''}. A sample:\n${sample}${warn}\n\nThe text on tuitions and profiles is not changed, and nothing is deleted.`,
      confirmLabel: `Approve ${items.length}`,
    })
    if (!yes) return
    setBusy(true)
    setOutcome(null)
    setProgress({ done: 0, total: items.length, label: KIND_LABEL[k] })
    const res: BatchOutcome<ReviewAction> = await runBatches(items, BATCH, postBatch, (done, total) => setProgress({ done, total, label: KIND_LABEL[k] }))
    setProgress(null)
    setBusy(false)
    setGone((g) => {
      const next = new Set(g)
      for (const a of res.done) next.add(keyOf(a))
      return next
    })
    setOutcome({ label: KIND_LABEL[k], done: res.done.length, failed: res.failed.map((f) => ({ value: f.item.value, city: f.item.city, error: f.error })) })
    if (res.failed.length === 0) toast.success(`${res.done.length} approved.`)
    else toast.error(`${res.done.length} approved, ${res.failed.length} not saved. See the list below.`)
    router.refresh()
    void load(0)
  }

  // ONE counts object drives the heading, summary, chips and bulk buttons.
  const view = reviewCountsView(counts, busy)
  const tabs = view.tabs
  const bulkButtons = view.bulk

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-black text-tm-navy">{view.heading}</h2>
      <p className="text-[11px] text-gray-600">{view.summary}</p>
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setKind(t.id)}
            aria-pressed={kind === t.id}
            className={`min-h-[44px] rounded-xl border px-3 text-xs font-bold ${
              kind === t.id ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700'
            }`}
          >
            {t.label} ({t.n})
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a typed area or city"
        aria-label="Find a typed area or city"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none"
      />

      {canApprove ? (
        <div className="flex flex-wrap items-center gap-2">
          {bulkButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={b.disabled}
              onClick={() => void bulk(b.id)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
            >
              {b.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-gray-600">View only — approvals are made by the Owner.</p>
      )}

      {progress && (
        <div role="status" className="space-y-1 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-700">
            Approving “{progress.label}”: {progress.done} of {progress.total}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-tm-bg" aria-hidden>
            <div className="h-full rounded-full bg-tm-navy" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </div>
      )}

      {outcome && (
        <div role="status" className="space-y-1 rounded-xl border border-gray-200 bg-white p-3 text-xs text-slate-700">
          <p className="font-bold">
            “{outcome.label}”: {outcome.done} approved{outcome.failed.length ? `, ${outcome.failed.length} not saved` : ''}.
          </p>
          {outcome.failed.length > 0 && (
            <ul className="space-y-0.5">
              {outcome.failed.slice(0, 50).map((f, i) => (
                <li key={`${f.city}|${f.value}|${i}`} className="text-tm-red">
                  “{f.value}” ({f.city || 'no city'}) — {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">{error}</p>}

      {!page && loading ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Getting the list…</p>
      ) : rows.length === 0 && !loading ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nothing to review here.</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((r) => {
            const areas = areasOf(r.city)
            const s = r.suggestion
            const suggestedArea = s.action === 'same' ? areas.find((a) => a.name.toLowerCase() === s.area.toLowerCase()) : undefined
            // One-click Approve of the suggestion (owner, 28 Oct 2026), when it can be saved as it is.
            const quick: ReviewAction | null =
              s.action === 'not_area'
                ? { action: 'not_area', value: r.value, city: r.city, reason: s.reason }
                : !r.cityListed
                  ? null
                  : s.action === 'same'
                    ? suggestedArea
                      ? { action: 'same', value: r.value, city: r.city, areaId: suggestedArea.id }
                      : null
                    : { action: 'add', value: r.value, city: r.city, name: s.name }
            return (
              <li key={r.key} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-tm-navy">{r.value}</p>
                  <p className="text-[11px] text-slate-700">
                    {r.city || 'No city'} · used {r.count} time{r.count === 1 ? '' : 's'}
                    {r.openTuitions > 0 ? ` · ${r.openTuitions} open tuition${r.openTuitions === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-700">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${CHIP[s.confidence]}`}>{CONFIDENCE_LABEL[s.confidence]}</span>
                  <span className="font-bold">Suggested: {suggestionLine(s)}</span>
                  <span className="text-gray-600">· {s.why}</span>
                </p>
                {!r.cityListed && (
                  <p className="text-[11px] text-gray-600">This city is not in the list, so an area cannot be saved under it. It can still be marked “Not an area”.</p>
                )}
                {canApprove && quick && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void one(quick)}
                    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60 sm:w-auto"
                  >
                    Approve: {suggestionLine(s)}
                  </button>
                )}
                {canApprove && (
                  <ThreeWayReview
                    labels={LABELS}
                    options={r.cityListed ? areas.map((a) => ({ id: String(a.id), label: a.name })) : []}
                    ignoreReasons={NOT_AREA_REASONS.map((x) => ({ id: x.id, label: x.label }))}
                    suggested={
                      s.action === 'same'
                        ? { action: 'same', optionId: suggestedArea ? String(suggestedArea.id) : undefined }
                        : s.action === 'not_area'
                          ? { action: 'ignore', reasonId: s.reason }
                          : { action: 'add', name: s.name }
                    }
                    busy={busy}
                    onAdd={r.cityListed ? (name) => void one({ action: 'add', value: r.value, city: r.city, name }) : undefined}
                    onSame={(id) => void one({ action: 'same', value: r.value, city: r.city, areaId: Number(id) })}
                    onIgnore={(reason) =>
                      void one({ action: 'not_area', value: r.value, city: r.city, reason: (reason ?? 'junk') as 'school' | 'address' | 'online' | 'junk' })
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {page && rows.length + gone.size < page.total && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load((page.rows.length ?? 0) + extra.length)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
        >
          {loading ? 'Getting more…' : `Load more (${page.total - (page.rows.length + extra.length)} left)`}
        </button>
      )}
    </div>
  )
}
