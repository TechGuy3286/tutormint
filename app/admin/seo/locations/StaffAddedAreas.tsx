'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'

// Admin → Locations: the areas staff added while posting a tuition (owner,
// 13 Oct 2026), each with "Added by <name>, <date>". If one turns out to be an
// area we already have, "Same as existing area" makes its name a spelling of
// that area and retires it — nothing is deleted and no tuition is changed.

type AreaSuggestion = { areaId: number; name: string; city: string; intoAreaId: number; intoName: string; landmark: string }

type Row = { id: number; name: string; city: string; line: string }

export default function StaffAddedAreas({
  areas,
  areasByCity,
  suggestions = [],
}: {
  areas: Row[]
  areasByCity: Record<string, { id: number; name: string }[]>
  /** "Same as <area>" + Block / landmark (owner, 16 Oct 2026); approving is the Owner's. */
  suggestions?: AreaSuggestion[]
}) {
  const canApprove = useCanApprove()
  const suggestionFor = new Map(suggestions.map((s) => [s.areaId, s]))
  const [approving, setApproving] = useState<number | 'all' | null>(null)
  const approve = async (areaId: number | 'all') => {
    setApproving(areaId)
    const { ok, data } = await adminFetch<{ error?: string; approved?: number; into?: string; tuitions?: number }>('/api/admin/locations/area', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(areaId === 'all' ? { action: 'approve_all' } : { action: 'approve_suggestion', areaId }),
    })
    setApproving(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(areaId === 'all' ? `${data?.approved ?? 0} suggestions approved.` : `Now counts as ${data?.into ?? 'that area'} · ${data?.tuitions ?? 0} tuitions got the landmark.`)
    router.refresh()
  }
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [pick, setPick] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)

  const merge = async (row: Row) => {
    const into = Number(pick[row.id])
    if (!into) {
      toast.error('Choose the area it is the same as.')
      return
    }
    setBusy(row.id)
    const { ok, data } = await adminFetch<{ error?: string; from?: string; into?: string }>('/api/admin/locations/area', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', areaId: row.id, intoAreaId: into }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`“${data?.from ?? row.name}” now counts as ${data?.into ?? 'that area'}.`)
    router.refresh()
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">Areas added by staff while posting ({areas.length})</h2>
        {canApprove && suggestions.length > 0 && (
          <button
            type="button"
            disabled={approving !== null}
            onClick={() => void approve('all')}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
          >
            {approving === 'all' ? 'Approving…' : `Approve all suggestions (${suggestions.length})`}
          </button>
        )}
      </div>
      {!canApprove && suggestions.length > 0 && (
        <p className="text-[11px] text-gray-600">View only — merges are approved by the Owner.</p>
      )}
      {areas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">No area has been added from the Post a tuition form yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {areas.map((a) => {
            const others = (areasByCity[a.city.toLowerCase()] ?? []).filter((x) => x.id !== a.id)
            return (
              <li key={a.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
                <p className="break-words text-sm font-black text-tm-navy">
                  {a.name} <span className="font-bold text-gray-600">· {a.city}</span>
                </p>
                <p className="text-[11px] text-slate-700">{a.line}</p>
                {suggestionFor.get(a.id) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-tm-tint-navy p-2">
                    <p className="text-[11px] font-semibold text-tm-navy">
                      Suggested: same as {suggestionFor.get(a.id)!.intoName}, landmark “{suggestionFor.get(a.id)!.landmark}”
                    </p>
                    {canApprove && (
                      <button
                        type="button"
                        disabled={approving !== null}
                        onClick={() => void approve(a.id)}
                        className="inline-flex min-h-[36px] items-center rounded-lg bg-tm-navy px-3 text-[11px] font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
                      >
                        {approving === a.id ? 'Approving…' : 'Approve'}
                      </button>
                    )}
                  </div>
                )}
                {!readOnly && canApprove && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Same as existing area</span>
                      <select
                        value={pick[a.id] ?? ''}
                        onChange={(e) => setPick((p) => ({ ...p, [a.id]: e.target.value }))}
                        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-slate-800"
                      >
                        <option value="">Same as existing area…</option>
                        {others.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy === a.id || !pick[a.id]}
                      onClick={() => void merge(a)}
                      className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
                    >
                      {busy === a.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
