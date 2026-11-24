'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { ALIAS_KINDS, DEMAND_KINDS, KIND_LABEL, type AliasKind } from '@/lib/searchTermsCore'

// One search word's actions on Admin → Growth → Search words (PR-22):
// "Means the same as…", "Real demand", and Undo on what is already set.

type Target = { kind: AliasKind; slug: string; name: string; city?: string }
type Live = { id: number; action: 'alias' | 'demand'; label: string }

const FIELD = 'min-h-[44px] rounded-xl border border-gray-200 bg-white px-2 text-xs font-bold text-tm-navy'
const BTN = 'inline-flex min-h-[44px] items-center rounded-xl border border-tm-navy/30 px-3 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50'

export default function TermActions({ term, canEdit, actions, targets }: { term: string; canEdit: boolean; actions: Live[]; targets: Target[] }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [open, setOpen] = useState<'alias' | 'demand' | null>(null)
  const [kind, setKind] = useState<AliasKind>('subject')
  const [city, setCity] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)

  const kinds = open === 'demand' ? (DEMAND_KINDS as AliasKind[]) : ALIAS_KINDS
  const areaCities = useMemo(() => [...new Set(targets.filter((t) => t.kind === 'area' && t.city).map((t) => t.city as string))].sort(), [targets])
  const options = targets.filter((t) => t.kind === kind && (kind !== 'area' || t.city === city))

  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; message?: string; id?: number }>('/api/admin/search-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return null
    }
    toast.success(data?.message ?? done)
    router.refresh()
    return data?.id ?? null
  }

  const save = async () => {
    if (!open || !slug) return
    const id = await send({ action: open, term, kind, slug }, 'Saved.')
    if (id) {
      setOpen(null)
      setSlug('')
    }
  }

  const undo = async (a: Live) => {
    if (a.action === 'alias') {
      const sure = await confirm({ title: 'Take this back?', body: `“${term}” will stop meaning ${a.label} in the search.`, confirmLabel: 'Undo' })
      if (!sure) return
    }
    await send({ action: 'undo', id: a.id }, 'Undone.')
  }

  return (
    <div className="space-y-2">
      {actions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-xl bg-tm-bg px-3 py-1 text-[11px] font-bold text-tm-navy">
              {a.action === 'alias' ? `Means ${a.label}` : `Real demand: ${a.label}`}
              {canEdit && (
                <button type="button" onClick={() => void undo(a)} disabled={busy} className="min-h-[36px] rounded-lg px-2 text-tm-red underline disabled:opacity-50">
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !open && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => { setOpen('alias'); setKind('subject'); setSlug('') }}>
            Means the same as…
          </button>
          {!actions.some((a) => a.action === 'demand') && (
            <button type="button" className={BTN} onClick={() => { setOpen('demand'); setKind('city'); setSlug('') }}>
              Real demand
            </button>
          )}
        </div>
      )}
      {canEdit && open && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 p-2">
          <label className="flex flex-col text-[11px] font-bold text-slate-700">
            {open === 'alias' ? 'Means the same as' : 'People want'}
            <select className={FIELD} value={kind} onChange={(e) => { setKind(e.target.value as AliasKind); setSlug(''); setCity('') }}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {kind === 'area' && (
            <label className="flex flex-col text-[11px] font-bold text-slate-700">
              City
              <select className={FIELD} value={city} onChange={(e) => { setCity(e.target.value); setSlug('') }}>
                <option value="">Choose a city</option>
                {areaCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-w-0 flex-col text-[11px] font-bold text-slate-700">
            {KIND_LABEL[kind]}
            <select className={`${FIELD} max-w-full`} value={slug} onChange={(e) => setSlug(e.target.value)} disabled={kind === 'area' && !city}>
              <option value="">Choose…</option>
              {options.map((t) => (
                <option key={`${t.kind}:${t.slug}`} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void save()} disabled={busy || !slug} className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-300">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setOpen(null)} className={BTN}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
