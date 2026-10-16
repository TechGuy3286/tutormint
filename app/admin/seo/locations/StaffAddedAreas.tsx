'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { runBatches } from '@/lib/batchRunCore'

// Admin → Locations → "Staff-added areas" (owner, 13 + 16 Oct 2026): areas
// staff added while posting a tuition, each with "Added by <name>, <date>".
// When one names an area we already have, a suggestion fills "Same as" and the
// Block / landmark ("KDA" + "Karaz Tipu Sultan Road"). The Owner can change
// either before approving. Approving makes the added name a spelling of that
// area and retires it (never deleted), and puts the landmark on the tuitions
// saved with that name — their saved text and URLs are unchanged.
// "Approve all suggestions" asks first (count + a sample of 5), then approves
// one area per request with a progress bar; a failure never stops the rest.

type AreaSuggestion = { areaId: number; name: string; city: string; intoAreaId: number; intoName: string; landmark: string }

type Row = { id: number; name: string; city: string; line: string }

export default function StaffAddedAreas({
  areas,
  areasByCity,
  suggestions = [],
}: {
  areas: Row[]
  areasByCity: Record<string, { id: number; name: string }[]>
  suggestions?: AreaSuggestion[]
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const canApprove = useCanApprove()
  const suggestionFor = new Map(suggestions.map((s) => [s.areaId, s]))
  const [into, setInto] = useState<Record<number, string>>(() => Object.fromEntries(suggestions.map((s) => [s.areaId, String(s.intoAreaId)])))
  const [landmark, setLandmark] = useState<Record<number, string>>(() => Object.fromEntries(suggestions.map((s) => [s.areaId, s.landmark])))
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<{ done: number; failed: { name: string; error: string }[] } | null>(null)

  /** Approve one area as shown on its card; true or the reason it did not save. */
  const send = async (row: Row, useEdits: boolean): Promise<true | string> => {
    const s = suggestionFor.get(row.id)
    const pickedInto = Number(into[row.id] ?? 0)
    const pickedLandmark = (landmark[row.id] ?? '').trim()
    const body: Record<string, unknown> = { action: 'approve_suggestion', areaId: row.id }
    if (useEdits && (!s || pickedInto !== s.intoAreaId || pickedLandmark !== s.landmark)) {
      if (!pickedInto) return 'Choose the area it is the same as.'
      body.intoAreaId = pickedInto
      body.landmark = pickedLandmark
    }
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/locations/area', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return ok ? true : (data?.error ?? 'That did not save.')
  }

  const approveOne = async (row: Row) => {
    setBusy(row.id)
    const r = await send(row, true)
    setBusy(null)
    if (r !== true) {
      toast.error(r)
      return
    }
    setDone((d) => new Set(d).add(row.id))
    toast.success(`“${row.name}” now counts as that area.`)
    router.refresh()
  }

  const waiting = areas.filter((a) => !done.has(a.id))
  const withSuggestion = waiting.filter((a) => suggestionFor.has(a.id))

  const approveAll = async () => {
    const list = withSuggestion
    if (list.length === 0) return
    const sample = list
      .slice(0, 5)
      .map((a) => {
        const s = suggestionFor.get(a.id)!
        return `• “${a.name}” (${a.city}) → same as ${s.intoName}${s.landmark ? `, landmark “${s.landmark}”` : ''}`
      })
      .join('\n')
    const yes = await confirm({
      title: `Approve all suggestions (${list.length})?`,
      body: `This approves ${list.length} area${list.length === 1 ? '' : 's'} exactly as suggested (your edits on the cards are not used — approve those one by one). A sample:\n${sample}\n\nNothing is deleted and tuitions keep their saved text.`,
      confirmLabel: `Approve ${list.length}`,
    })
    if (!yes) return
    setBusy('all')
    setOutcome(null)
    setProgress({ done: 0, total: list.length })
    const res = await runBatches(list, 1, async ([row]) => [await send(row, false)], (d, t) => setProgress({ done: d, total: t }))
    setProgress(null)
    setBusy(null)
    setDone((d) => {
      const next = new Set(d)
      for (const a of res.done) next.add(a.id)
      return next
    })
    setOutcome({ done: res.done.length, failed: res.failed.map((f) => ({ name: `${f.item.name} (${f.item.city})`, error: f.error })) })
    if (res.failed.length === 0) toast.success(`${res.done.length} approved.`)
    else toast.error(`${res.done.length} approved, ${res.failed.length} not saved. See the list.`)
    router.refresh()
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">
          Staff-added areas ({waiting.length}
          {withSuggestion.length ? `, ${withSuggestion.length} with a suggestion` : ''})
        </h2>
        {canApprove && withSuggestion.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void approveAll()}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
          >
            Approve all suggestions ({withSuggestion.length})
          </button>
        )}
      </div>
      {!canApprove && <p className="text-[11px] text-gray-600">View only — approvals are made by the Owner.</p>}

      {progress && (
        <div role="status" className="space-y-1 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-700">
            Approving: {progress.done} of {progress.total}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-tm-bg" aria-hidden>
            <div className="h-full rounded-full bg-tm-navy" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </div>
      )}
      {outcome && (
        <div role="status" className="space-y-1 rounded-xl border border-gray-200 bg-white p-3 text-xs text-slate-700">
          <p className="font-bold">
            {outcome.done} approved{outcome.failed.length ? `, ${outcome.failed.length} not saved` : ''}.
          </p>
          {outcome.failed.map((f, i) => (
            <p key={`${f.name}-${i}`} className="text-tm-red">
              {f.name} — {f.error}
            </p>
          ))}
        </div>
      )}

      {waiting.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">No area added from the Post a tuition form is waiting.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {waiting.map((a) => {
            const s = suggestionFor.get(a.id)
            const others = (areasByCity[a.city.toLowerCase()] ?? []).filter((x) => x.id !== a.id)
            return (
              <li key={a.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
                <p className="break-words text-sm font-black text-tm-navy">
                  {a.name} <span className="font-bold text-gray-600">· {a.city}</span>
                </p>
                <p className="text-[11px] text-slate-700">{a.line}</p>
                {s ? (
                  <p className="rounded-xl bg-tm-tint-navy p-2 text-[11px] font-semibold text-tm-navy">
                    Suggested: same as {s.intoName}
                    {s.landmark ? `, landmark “${s.landmark}”` : ''}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-600">No suggestion. Choose the area it is the same as, if any.</p>
                )}
                {canApprove && (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-700">Same as existing area</span>
                      <select
                        value={into[a.id] ?? ''}
                        onChange={(e) => setInto((p) => ({ ...p, [a.id]: e.target.value }))}
                        className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-slate-800"
                      >
                        <option value="">Choose an area…</option>
                        {others.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-700">Block / landmark (optional)</span>
                      <input
                        value={landmark[a.id] ?? ''}
                        maxLength={120}
                        onChange={(e) => setLandmark((p) => ({ ...p, [a.id]: e.target.value }))}
                        placeholder="e.g. Block 1"
                        className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs text-slate-800 focus:border-tm-navy focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy !== null || !into[a.id]}
                      onClick={() => void approveOne(a)}
                      className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
                    >
                      {busy === a.id ? 'Approving…' : 'Approve'}
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
