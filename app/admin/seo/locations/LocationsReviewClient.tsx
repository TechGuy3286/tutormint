'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import ThreeWayReview, { type ReviewLabels } from '@/components/admin/ThreeWayReview'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { CONFIDENCE_LABEL, NOT_AREA_REASONS, suggestionLine, type Suggestion } from '@/lib/locationCleanCore'
import type { ReviewAction, ReviewRow } from '@/lib/locationReview'

// Admin → Locations → the review list (owner, 13 Oct 2026). Each typed area has
// a suggested action and three buttons; rows can be ticked and approved
// together. Nothing is saved until staff approve it.

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

type Filter = 'all' | 'same' | 'not_area' | 'add'

function toAction(r: ReviewRow, areas: { id: number; name: string }[]): ReviewAction | null {
  const s: Suggestion = r.suggestion
  if (s.action === 'not_area') return { action: 'not_area', value: r.value, city: r.city, reason: s.reason }
  if (!r.cityListed) return null
  if (s.action === 'same') {
    const area = areas.find((a) => a.name.toLowerCase() === s.area.toLowerCase())
    return area ? { action: 'same', value: r.value, city: r.city, areaId: area.id } : null
  }
  return { action: 'add', value: r.value, city: r.city, name: s.name }
}

export default function LocationsReviewClient({
  rows,
  areasByCity,
}: {
  rows: ReviewRow[]
  areasByCity: Record<string, { id: number; name: string }[]>
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [find, setFind] = useState('')
  const [shown, setShown] = useState(60)

  const areasOf = (city: string) => areasByCity[city.trim().toLowerCase()] ?? []

  const list = useMemo(() => {
    const q = find.trim().toLowerCase()
    return rows.filter(
      (r) =>
        !gone.has(r.key) &&
        (filter === 'all' || r.suggestion.action === filter) &&
        (!q || r.value.toLowerCase().includes(q) || r.city.toLowerCase().includes(q)),
    )
  }, [rows, gone, filter, find])

  const send = async (items: ReviewAction[], keys: string[]) => {
    if (items.length === 0) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; saved?: number; failed?: number; results?: { value: string; ok: boolean; message: string }[]; hubsQueued?: string[] }>(
      '/api/admin/locations',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) },
    )
    setBusy(false)
    if (!ok || !data?.saved) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    const okValues = new Set((data.results ?? []).filter((r) => r.ok).map((r) => r.value.toLowerCase()))
    setGone((g) => {
      const next = new Set(g)
      for (const k of keys) if (okValues.has(k.split('|').slice(1).join('|'))) next.add(k)
      return next
    })
    setTicked(new Set())
    const hubs = data.hubsQueued?.length ?? 0
    const first = data.results?.find((r) => r.ok)?.message
    toast.success(
      items.length === 1 && first
        ? `${first}${hubs ? ' Its area page has 3 or more open tuitions and was sent to Google.' : ''}`
        : `${data.saved} saved${data.failed ? `, ${data.failed} not saved` : ''}.${hubs ? ` ${hubs} area page${hubs === 1 ? '' : 's'} sent to Google.` : ''}`,
    )
    router.refresh()
  }

  const approve = async (targets: ReviewRow[], word: string) => {
    const pairs = targets.map((r) => ({ r, a: toAction(r, areasOf(r.city)) })).filter((p): p is { r: ReviewRow; a: ReviewAction } => p.a !== null)
    if (pairs.length === 0) {
      toast.error('None of these rows has a suggestion that can be saved as it is. Use the buttons on the row.')
      return
    }
    const n = pairs.length
    const yes = await confirm({
      title: `Approve ${n} suggestion${n === 1 ? '' : 's'}?`,
      body: `${word} Each row is saved as its suggestion shows. The text on tuitions and profiles is not changed, and nothing is deleted.`,
      confirmLabel: `Approve ${n}`,
    })
    if (!yes) return
    await send(pairs.map((p) => p.a), pairs.map((p) => p.r.key))
  }

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: rows.filter((r) => !gone.has(r.key)).length },
    { id: 'same', label: 'Same as an area', n: rows.filter((r) => !gone.has(r.key) && r.suggestion.action === 'same').length },
    { id: 'not_area', label: 'Not an area', n: rows.filter((r) => !gone.has(r.key) && r.suggestion.action === 'not_area').length },
    { id: 'add', label: 'New area', n: rows.filter((r) => !gone.has(r.key) && r.suggestion.action === 'add').length },
  ]
  const visible = list.slice(0, shown)
  const tickedRows = list.filter((r) => ticked.has(r.key))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setFilter(t.id)
              setShown(60)
            }}
            aria-pressed={filter === t.id}
            className={`min-h-[44px] rounded-xl border px-3 text-xs font-bold ${
              filter === t.id ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700'
            }`}
          >
            {t.label} ({t.n})
          </button>
        ))}
      </div>

      <input
        value={find}
        onChange={(e) => {
          setFind(e.target.value)
          setShown(60)
        }}
        placeholder="Find a typed area or city"
        aria-label="Find a typed area or city"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none"
      />

      {!readOnly && list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || tickedRows.length === 0}
            onClick={() => approve(tickedRows, 'Only the ticked rows.')}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
          >
            <CheckCheck aria-hidden size={14} />
            Approve selected ({tickedRows.length})
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => approve(list, `Every row in this list (${list.length}).`)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
          >
            Approve all suggestions ({list.length})
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setTicked((t) => (t.size > 0 ? new Set() : new Set(visible.map((r) => r.key))))}
            className="min-h-[44px] px-2 text-xs font-bold text-tm-navy underline"
          >
            {ticked.size > 0 ? 'Untick all' : 'Tick the rows shown'}
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nothing to review here.</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {visible.map((r) => {
            const areas = areasOf(r.city)
            const s = r.suggestion
            const suggestedArea = s.action === 'same' ? areas.find((a) => a.name.toLowerCase() === s.area.toLowerCase()) : undefined
            return (
              <li key={r.key} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex items-start gap-2">
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={ticked.has(r.key)}
                      onChange={(e) =>
                        setTicked((t) => {
                          const next = new Set(t)
                          if (e.target.checked) next.add(r.key)
                          else next.delete(r.key)
                          return next
                        })
                      }
                      aria-label={`Select ${r.value}`}
                      className="mt-1 h-5 w-5 shrink-0 accent-tm-navy"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-black text-tm-navy">{r.value}</p>
                    <p className="text-[11px] text-slate-700">
                      {r.city || 'No city'} · used {r.count} time{r.count === 1 ? '' : 's'}
                      {r.openTuitions > 0 ? ` · ${r.openTuitions} open tuition${r.openTuitions === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                </div>
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-700">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${CHIP[s.confidence]}`}>{CONFIDENCE_LABEL[s.confidence]}</span>
                  <span className="font-bold">Suggested: {suggestionLine(s)}</span>
                  <span className="text-gray-600">· {s.why}</span>
                </p>
                {!r.cityListed && (
                  <p className="text-[11px] text-gray-600">This city is not in the list, so an area cannot be saved under it. It can still be marked “Not an area”.</p>
                )}
                {!readOnly && (
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
                    onAdd={r.cityListed ? (name) => send([{ action: 'add', value: r.value, city: r.city, name }], [r.key]) : undefined}
                    onSame={(id) => send([{ action: 'same', value: r.value, city: r.city, areaId: Number(id) }], [r.key])}
                    onIgnore={(reason) =>
                      send([{ action: 'not_area', value: r.value, city: r.city, reason: (reason ?? 'junk') as 'school' | 'address' | 'online' | 'junk' }], [r.key])
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {list.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + 60)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-xs font-bold text-slate-700 hover:border-tm-navy"
        >
          Show more ({list.length - shown} left)
        </button>
      )}
    </div>
  )
}
