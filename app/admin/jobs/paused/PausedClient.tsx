'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PlayCircle } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDate } from '@/lib/datetime'
import type { PausedFilters, PausedRow } from '@/lib/pausedTuitions'

export default function PausedClient({
  rows,
  cities,
  filters,
  backlogLine,
}: {
  rows: PausedRow[]
  cities: string[]
  filters: PausedFilters
  backlogLine: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const href = (patch: Partial<Record<'city' | 'age' | 'apps', string>>) => {
    const p = new URLSearchParams()
    const next = { city: filters.city ?? '', age: filters.age ?? '', apps: filters.apps ?? '', ...patch }
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    return `/admin/jobs/paused${p.toString() ? `?${p}` : ''}`
  }

  const resume = async (ids: string[]) => {
    if (ids.length === 0) return
    const ok = await confirm({
      title: ids.length === 1 ? 'Resume this tuition?' : `Resume ${ids.length} tuitions?`,
      body: 'Each one goes back on Browse and Google Jobs for a fresh 7 days, on the same address. The poster is told.',
      confirmLabel: ids.length === 1 ? 'Resume' : 'Resume selected',
    })
    if (!ok) return
    setBusy(true)
    const r = await adminFetch<{ error?: string; resumed?: number; skipped?: number }>('/api/admin/jobs/paused', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    setBusy(false)
    if (r.ok) {
      const n = r.data?.resumed ?? 0
      toast.success(`${n} tuition${n === 1 ? '' : 's'} resumed for 7 days.${r.data?.skipped ? ` ${r.data.skipped} were already open.` : ''}`)
      setPicked(new Set())
      router.refresh()
    } else {
      toast.error(r.data?.error ?? 'That did not go through. Please try again.')
    }
  }

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 ring-1 ${active ? 'bg-tm-navy text-white ring-tm-navy' : 'bg-white text-tm-navy ring-gray-200'}`

  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id))

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-tm-tint-navy px-3 py-2 text-xs font-bold text-tm-navy">{backlogLine}</p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
        <select
          aria-label="City"
          value={filters.city ?? ''}
          onChange={(e) => router.push(href({ city: e.target.value }))}
          className="min-h-[36px] rounded-full border border-gray-200 bg-white px-3 text-tm-navy"
        >
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Link href={href({ age: '' })} className={chip(!filters.age)}>Any time</Link>
        <Link href={href({ age: 'week' })} className={chip(filters.age === 'week')}>Paused this week</Link>
        <Link href={href({ age: 'older' })} className={chip(filters.age === 'older')}>Older</Link>
        <Link href={href({ apps: '' })} className={chip(!filters.apps)}>All</Link>
        <Link href={href({ apps: 'with' })} className={chip(filters.apps === 'with')}>With applications</Link>
        <Link href={href({ apps: 'without' })} className={chip(filters.apps === 'without')}>Without applications</Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {rows.length} paused tuition{rows.length === 1 ? '' : 's'} (auto-paused after 7 days), newest first.
        </p>
        {!readOnly && (
          <button
            type="button"
            disabled={busy || picked.size === 0}
            onClick={() => resume([...picked])}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden size={14} className="animate-spin" /> : <PlayCircle aria-hidden size={14} />}
            Resume selected ({picked.size})
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No paused tuitions match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-tm-bg text-[11px] uppercase text-gray-500">
              <tr>
                <th className="p-2">
                  {!readOnly && (
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  )}
                </th>
                <th className="p-2">Tuition</th>
                <th className="p-2">City · area</th>
                <th className="p-2">Grade</th>
                <th className="p-2">Poster</th>
                <th className="p-2">Paused</th>
                <th className="p-2">Applications</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="p-2">
                    {!readOnly && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.refId ?? r.title}`}
                        checked={picked.has(r.id)}
                        onChange={() => {
                          const n = new Set(picked)
                          if (n.has(r.id)) n.delete(r.id)
                          else n.add(r.id)
                          setPicked(n)
                        }}
                      />
                    )}
                  </td>
                  <td className="p-2">
                    <Link href={`/admin/jobs/${r.id}`} className="font-bold text-tm-navy hover:underline">
                      {r.refId ? `${r.refId} · ` : ''}
                      {r.title}
                    </Link>
                  </td>
                  <td className="p-2 text-gray-700">{[r.city, r.area].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="p-2 text-gray-700">{r.grade ?? '—'}</td>
                  <td className="p-2 text-gray-700">{r.poster}</td>
                  <td className="p-2 text-gray-700">{formatDate(r.pausedAt)}</td>
                  <td className="p-2 text-gray-700">{r.applications}</td>
                  <td className="p-2">
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resume([r.id])}
                        className="min-h-[36px] rounded-lg border border-tm-green-deep px-3 font-bold text-tm-green-deep hover:bg-tm-tint-green disabled:opacity-50"
                      >
                        Resume
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
