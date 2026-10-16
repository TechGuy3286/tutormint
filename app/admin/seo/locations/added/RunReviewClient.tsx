'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useCanApprove, OwnerOnlyNote } from '@/components/admin/ReadOnly'
import { runBatches } from '@/lib/batchRunCore'
import { NOT_AREA_REASONS } from '@/lib/locationCleanCore'
import { DECISION_LABEL, WARNING_LABEL, confirmLine, runActionProblem, type RunAction } from '@/lib/locationRunCore'
import type { RunAliasRow, RunAreaRow, RunBoard, RunIgnoredRow } from '@/lib/locationRunReview'

// Locations → Review added areas (owner, 16 Oct 2026). Three lists — the 120
// areas, the 142 "same as" spellings and the 44 "Not an area" values the 16 Oct
// run wrote. Each row has its own choice; tick rows and press Apply, confirm,
// and the choices go in batches of 20. Only the Owner can apply (the server
// refuses everyone else); other roles see the lists.

type Tab = 'areas' | 'aliases' | 'ignored'
type Choice = { decision: string; into?: number; landmark?: string; reason?: string; name?: string }

const BATCH = 20

const box = 'space-y-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs'
const field = 'min-h-[36px] rounded-lg border border-gray-200 bg-white px-2 text-xs text-slate-800'

function Reviewed({ r }: { r: { decision: string } | null }) {
  if (!r) return null
  return <span className="rounded-full bg-tm-tint-green px-2 py-0.5 text-[10px] font-bold text-tm-green-deep">Reviewed: {DECISION_LABEL[r.decision] ?? r.decision}</span>
}

function AreaPicker({ list, value, onChange, exclude }: { list: { id: number; name: string }[]; value?: number; onChange: (v: number) => void; exclude?: number }) {
  return (
    <select className={field} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="">Same as…</option>
      {list
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  )
}

export default function RunReviewClient({ board }: { board: RunBoard }) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const canApply = useCanApprove()
  const [tab, setTab] = useState<Tab>('areas')
  const [onlyWarned, setOnlyWarned] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [failed, setFailed] = useState<string[]>([])

  const pick = (key: string, c: Partial<Choice>) => {
    setChoices((cur) => ({ ...cur, [key]: { ...cur[key], ...c, decision: c.decision ?? cur[key]?.decision ?? 'keep' } }))
    setTicked((cur) => new Set(cur).add(key))
  }
  const tick = (key: string, on: boolean) =>
    setTicked((cur) => {
      const n = new Set(cur)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  const listFor = (city: string) => board.areasByCity[city.trim().toLowerCase()] ?? []

  const areas = useMemo(() => board.areas.filter((a) => !onlyWarned || a.warnings.length > 0), [board.areas, onlyWarned])

  function actionFor(key: string): RunAction | string {
    const [kind, idText] = key.split(':')
    const id = Number(idText)
    const c = choices[key] ?? { decision: 'keep' }
    let a: RunAction
    if (kind === 'area') {
      if (c.decision === 'merge') a = { kind: 'area', id, decision: 'merge', intoAreaId: c.into ?? 0 }
      else if (c.decision === 'split') a = { kind: 'area', id, decision: 'split', intoAreaId: c.into ?? 0, landmark: c.landmark ?? '' }
      else if (c.decision === 'not_area') a = { kind: 'area', id, decision: 'not_area', reason: (c.reason as 'junk') ?? 'junk' }
      else a = { kind: 'area', id, decision: 'keep' }
    } else if (kind === 'alias') {
      a = c.decision === 'rematch' ? { kind: 'alias', id, decision: 'rematch', areaId: c.into ?? 0 } : { kind: 'alias', id, decision: 'keep' }
    } else {
      if (c.decision === 'same_as') a = { kind: 'ignored', id, decision: 'same_as', areaId: c.into ?? 0 }
      else if (c.decision === 'actually_area') a = { kind: 'ignored', id, decision: 'actually_area', name: c.name ?? '' }
      else a = { kind: 'ignored', id, decision: 'keep' }
    }
    return runActionProblem(a) ?? a
  }

  async function apply() {
    const keys = [...ticked].filter((k) => k.startsWith(tab === 'areas' ? 'area:' : tab === 'aliases' ? 'alias:' : 'ignored:'))
    if (keys.length === 0) {
      toast.error('Tick at least one row first.')
      return
    }
    const items: RunAction[] = []
    for (const k of keys) {
      const a = actionFor(k)
      if (typeof a === 'string') {
        toast.error(a)
        return
      }
      items.push(a)
    }
    const yes = await confirm({ title: `Apply ${items.length} change${items.length === 1 ? '' : 's'}?`, body: confirmLine(items.length), confirmLabel: `Apply ${items.length}`, destructive: false })
    if (!yes) return
    setBusy(true)
    setFailed([])
    const res = await runBatches(
      items,
      BATCH,
      async (batch) => {
        const r = await fetch('/api/admin/locations/run-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: batch }) })
        const data = (await r.json().catch(() => ({}))) as { error?: string; results?: { ok: boolean; message: string }[] }
        if (!data.results) throw new Error(data.error ?? 'That batch did not go through.')
        return data.results.map((x) => (x.ok ? true : x.message))
      },
      (done, total) => setProgress(`${done} of ${total} done`),
    )
    setProgress(null)
    setBusy(false)
    setTicked(new Set())
    if (res.failed.length) setFailed(res.failed.map((f) => `${f.item.kind} ${f.item.id}: ${f.error}`))
    if (res.done.length) toast.success(`${res.done.length} change${res.done.length === 1 ? '' : 's'} saved.`)
    else toast.error('Nothing was saved.')
    router.refresh()
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'areas', label: `Added areas (${board.areas.length})` },
    { key: 'aliases', label: `“Same as” matches (${board.aliases.length})` },
    { key: 'ignored', label: `“Not an area” (${board.ignored.length})` },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-[40px] rounded-full px-4 text-xs font-bold ${tab === t.key ? 'bg-tm-navy text-white' : 'border border-gray-200 bg-white text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canApply && <OwnerOnlyNote />}

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
        {tab === 'areas' && (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={onlyWarned} onChange={(e) => setOnlyWarned(e.target.checked)} /> Only rows with a warning
          </label>
        )}
        {canApply && (
          <button type="button" disabled={busy} onClick={apply} className="min-h-[40px] rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60">
            Apply ticked ({[...ticked].filter((k) => k.startsWith(tab === 'areas' ? 'area:' : tab === 'aliases' ? 'alias:' : 'ignored:')).length})
          </button>
        )}
        {progress && <span className="text-xs font-bold text-tm-navy">{progress}</span>}
      </div>
      {failed.length > 0 && (
        <div className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs text-tm-red">
          <p className="font-bold">Not saved:</p>
          <ul className="list-disc pl-5">
            {failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'areas' && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {areas.map((a) => (
            <AreaCard key={a.id} a={a} list={listFor(a.city)} choice={choices[`area:${a.id}`]} ticked={ticked.has(`area:${a.id}`)} canApply={canApply} onPick={(c) => pick(`area:${a.id}`, c)} onTick={(on) => tick(`area:${a.id}`, on)} />
          ))}
        </ul>
      )}
      {tab === 'aliases' && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {board.aliases.map((a) => (
            <AliasCard key={a.id} a={a} list={listFor(a.city)} choice={choices[`alias:${a.id}`]} ticked={ticked.has(`alias:${a.id}`)} canApply={canApply} onPick={(c) => pick(`alias:${a.id}`, c)} onTick={(on) => tick(`alias:${a.id}`, on)} />
          ))}
        </ul>
      )}
      {tab === 'ignored' && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {board.ignored.map((a) => (
            <IgnoredCard key={a.id} a={a} list={listFor(a.city)} choice={choices[`ignored:${a.id}`]} ticked={ticked.has(`ignored:${a.id}`)} canApply={canApply} onPick={(c) => pick(`ignored:${a.id}`, c)} onTick={(on) => tick(`ignored:${a.id}`, on)} />
          ))}
        </ul>
      )}
    </div>
  )
}

type CardProps<T> = { a: T; list: { id: number; name: string }[]; choice?: Choice; ticked: boolean; canApply: boolean; onPick: (c: Partial<Choice>) => void; onTick: (on: boolean) => void }

function Tick({ ticked, onTick, canApply, disabled }: { ticked: boolean; onTick: (on: boolean) => void; canApply: boolean; disabled?: boolean }) {
  if (!canApply) return null
  return <input type="checkbox" aria-label="Tick this row" className="mt-1 h-4 w-4" checked={ticked} disabled={disabled} onChange={(e) => onTick(e.target.checked)} />
}

function AreaCard({ a, list, choice, ticked, canApply, onPick, onTick }: CardProps<RunAreaRow>) {
  const d = choice?.decision ?? 'keep'
  return (
    <li className={box}>
      <div className="flex items-start gap-2">
        <Tick ticked={ticked} onTick={onTick} canApply={canApply} disabled={a.retired} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-tm-navy">{a.name}</p>
            <span className="text-gray-600">{a.city}</span>
            {a.retired && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">Retired</span>}
            <Reviewed r={a.review} />
          </div>
          <p className="text-slate-700">
            {a.tuitions} tuitions ({a.openTuitions} open) · {a.profiles} profiles
            {a.spellings.length > 0 ? ` · spellings: ${a.spellings.join(', ')}` : ''}
          </p>
          <p className="text-slate-700">
            Public hub page:{' '}
            {a.hub ? (
              <a href={a.hub} target="_blank" rel="noopener noreferrer" className="font-bold text-tm-red hover:underline">
                {a.hub}
              </a>
            ) : (
              'none'
            )}
          </p>
          {a.warnings.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {a.warnings.map((w) => (
                <li key={w} className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">
                  {WARNING_LABEL[w]}
                  {w === 'close_spelling' && a.closeTo ? `: ${a.closeTo.name}` : ''}
                </li>
              ))}
            </ul>
          )}
          {canApply && !a.retired && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select className={field} value={d} onChange={(e) => onPick({ decision: e.target.value, into: choice?.into ?? a.closeTo?.id })}>
                <option value="keep">Keep</option>
                <option value="merge">Same as an existing area (merge)</option>
                <option value="split">Split into area + Block / landmark</option>
                <option value="not_area">Mark “Not an area”</option>
              </select>
              {(d === 'merge' || d === 'split') && <AreaPicker list={list} exclude={a.id} value={choice?.into} onChange={(v) => onPick({ into: v })} />}
              {d === 'split' && (
                <input className={field} placeholder="Block / landmark" value={choice?.landmark ?? ''} onChange={(e) => onPick({ landmark: e.target.value })} />
              )}
              {d === 'not_area' && (
                <select className={field} value={choice?.reason ?? 'junk'} onChange={(e) => onPick({ reason: e.target.value })}>
                  {NOT_AREA_REASONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function AliasCard({ a, list, choice, ticked, canApply, onPick, onTick }: CardProps<RunAliasRow>) {
  const d = choice?.decision ?? 'keep'
  return (
    <li className={box}>
      <div className="flex items-start gap-2">
        <Tick ticked={ticked} onTick={onTick} canApply={canApply} disabled={a.retired} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-tm-navy">“{a.raw}”</p>
            <span className="text-gray-600">{a.city}</span>
            {a.retired && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">Changed</span>}
            <Reviewed r={a.review} />
          </div>
          <p className="text-slate-700">
            Counts as <strong>{a.areaName || '—'}</strong> · used {a.uses} {a.uses === 1 ? 'time' : 'times'}
          </p>
          {canApply && !a.retired && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select className={field} value={d} onChange={(e) => onPick({ decision: e.target.value })}>
                <option value="keep">Keep this match</option>
                <option value="rematch">Change the match</option>
              </select>
              {d === 'rematch' && <AreaPicker list={list} exclude={a.areaId} value={choice?.into} onChange={(v) => onPick({ into: v })} />}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function IgnoredCard({ a, list, choice, ticked, canApply, onPick, onTick }: CardProps<RunIgnoredRow>) {
  const d = choice?.decision ?? 'keep'
  return (
    <li className={box}>
      <div className="flex items-start gap-2">
        <Tick ticked={ticked} onTick={onTick} canApply={canApply} disabled={a.retired} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-tm-navy">“{a.raw}”</p>
            <span className="text-gray-600">{a.city || 'No city'}</span>
            {a.retired && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">Changed</span>}
            <Reviewed r={a.review} />
          </div>
          <p className="text-slate-700">
            Marked: {NOT_AREA_REASONS.find((r) => r.id === a.reason)?.label ?? a.reason} · used {a.uses} {a.uses === 1 ? 'time' : 'times'}
          </p>
          {canApply && !a.retired && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select className={field} value={d} onChange={(e) => onPick({ decision: e.target.value, name: choice?.name ?? a.raw })}>
                <option value="keep">Keep as not an area</option>
                <option value="actually_area">Actually an area (add it)</option>
                <option value="same_as">Same as an existing area</option>
              </select>
              {d === 'actually_area' && <input className={field} value={choice?.name ?? a.raw} onChange={(e) => onPick({ name: e.target.value })} />}
              {d === 'same_as' && <AreaPicker list={list} value={choice?.into} onChange={(v) => onPick({ into: v })} />}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
