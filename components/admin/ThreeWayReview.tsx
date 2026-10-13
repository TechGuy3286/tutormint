'use client'

import { useMemo, useState } from 'react'
import { Check, EyeOff, Link2, Plus } from 'lucide-react'

// The three-button review pattern (owner, 13 Oct 2026), shared by Locations
// (a typed area) and Unmet searches (a searched term). For one typed value
// staff choose ONE of:
//
//   add     it is something new        → a small form, the name pre-filled
//   same    it is one we already have  → a searchable picker
//   ignore  it is neither              → hidden from the list (never deleted)
//
// The component only collects the choice; the caller saves it. `suggested`
// marks the button the system proposes and pre-selects its option.

export type ReviewOption = { id: string; label: string; hint?: string }

export type ReviewLabels = {
  add: string
  same: string
  ignore: string
  /** The label over the name box in the Add form. */
  nameLabel: string
  /** The placeholder of the picker's search box. */
  findPlaceholder: string
}

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold disabled:opacity-60'
const PLAIN = `${BTN} border-gray-200 bg-white text-slate-700 hover:border-tm-navy`
const MARKED = `${BTN} border-tm-navy bg-tm-tint-navy text-tm-navy`
const SAVE = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const INPUT = 'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'

export default function ThreeWayReview({
  labels,
  options,
  ignoreReasons,
  suggested,
  busy,
  addExtra,
  addReady = true,
  onAdd,
  onSame,
  onIgnore,
}: {
  labels: ReviewLabels
  options: ReviewOption[]
  /** When given, Ignore asks which kind it is. */
  ignoreReasons?: ReviewOption[]
  suggested?: { action: 'add' | 'same' | 'ignore'; name?: string; optionId?: string; reasonId?: string } | null
  busy?: boolean
  /** Extra fields of the Add form (e.g. which level a new subject belongs to). */
  addExtra?: React.ReactNode
  /** False while those extra fields are not filled in. */
  addReady?: boolean
  onAdd?: (name: string) => void
  onSame: (optionId: string) => void
  onIgnore: (reasonId: string | null) => void
}) {
  const [panel, setPanel] = useState<'add' | 'same' | 'ignore' | null>(null)
  const [name, setName] = useState(suggested?.name ?? '')
  const [find, setFind] = useState('')
  const [pick, setPick] = useState<string | null>(suggested?.action === 'same' ? (suggested.optionId ?? null) : null)
  const [reason, setReason] = useState<string | null>(suggested?.action === 'ignore' ? (suggested.reasonId ?? null) : null)

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : options
    // The picked option stays visible whatever is typed.
    const picked = options.find((o) => o.id === pick)
    const top = list.slice(0, 24)
    return picked && !top.some((o) => o.id === picked.id) ? [picked, ...top] : top
  }, [options, find, pick])

  const cls = (a: 'add' | 'same' | 'ignore') => (panel === a || (panel === null && suggested?.action === a) ? MARKED : PLAIN)
  const toggle = (a: 'add' | 'same' | 'ignore') => setPanel((p) => (p === a ? null : a))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {onAdd && (
          <button type="button" disabled={busy} onClick={() => toggle('add')} className={cls('add')} aria-expanded={panel === 'add'}>
            <Plus aria-hidden size={14} />
            {labels.add}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => toggle('same')} className={cls('same')} aria-expanded={panel === 'same'}>
          <Link2 aria-hidden size={14} />
          {labels.same}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (ignoreReasons && ignoreReasons.length > 0 ? toggle('ignore') : onIgnore(null))}
          className={cls('ignore')}
          aria-expanded={panel === 'ignore'}
        >
          <EyeOff aria-hidden size={14} />
          {labels.ignore}
        </button>
      </div>

      {panel === 'add' && onAdd && (
        <div className="space-y-2 rounded-xl bg-tm-bg p-3">
          <label className="block space-y-1">
            <span className="block text-[11px] font-bold text-gray-600">{labels.nameLabel}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={INPUT} />
          </label>
          {addExtra}
          <button type="button" disabled={busy || !addReady || name.trim().length < 2} onClick={() => onAdd(name.trim())} className={SAVE}>
            <Check aria-hidden size={14} />
            Save
          </button>
        </div>
      )}

      {panel === 'same' && (
        <div className="space-y-2 rounded-xl bg-tm-bg p-3">
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={labels.findPlaceholder}
            aria-label={labels.findPlaceholder}
            className={INPUT}
          />
          {shown.length === 0 ? (
            <p className="text-[11px] text-gray-600">Nothing matches. Try another spelling.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {shown.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setPick(o.id)}
                    aria-pressed={pick === o.id}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-xs font-semibold ${
                      pick === o.id ? 'border-tm-navy bg-tm-tint-navy text-tm-navy' : 'border-gray-200 bg-white text-slate-700'
                    }`}
                  >
                    <span className="min-w-0 break-words">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-[11px] font-normal text-gray-600">{o.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" disabled={busy || !pick} onClick={() => pick && onSame(pick)} className={SAVE}>
            <Check aria-hidden size={14} />
            Save
          </button>
        </div>
      )}

      {panel === 'ignore' && ignoreReasons && (
        <div className="space-y-2 rounded-xl bg-tm-bg p-3">
          <div className="flex flex-wrap gap-2">
            {ignoreReasons.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(r.id)}
                aria-pressed={reason === r.id}
                className={reason === r.id ? MARKED : PLAIN}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy || !reason} onClick={() => onIgnore(reason)} className={SAVE}>
            <Check aria-hidden size={14} />
            Save
          </button>
        </div>
      )}
    </div>
  )
}
