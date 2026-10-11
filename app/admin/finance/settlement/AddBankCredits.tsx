'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { alertNote, parseBankAlerts, planAlerts, unreadableText, type AlertCredit, type AlertField } from '@/lib/bankAlertCore'
import { formatDate } from '@/lib/datetime'
import { parseAmount, pkr } from '@/lib/reconciliationCore'
import { isPayproSender, refKey } from '@/lib/settlementMatchCore'

// Settlements → "Add bank credit" (owner, 11 Oct 2026): paste only. The owner
// pastes one or more Faysal Bank alerts; they are read as soon as the text lands
// (lib/bankAlertCore, in the browser — the alert text itself is never sent) and
// shown as read-only cards. One button saves every readable, not-yet-saved
// credit. Typing a credit by hand is still possible behind a small link.
// Rendered only for the owner; the server refuses everyone else anyway.

const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'
const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold'

type Edit = { date?: string; amount?: string; reference?: string }
type SaveResult = { reference: string; ok: boolean; matched?: boolean; match?: string; duplicate?: boolean; error?: string }
type SaveResponse = { error?: string; results?: SaveResult[] }

const EMPTY_HAND = { date: '', time: '', amountPkr: '', senderName: '', senderBank: '', reference: '', note: '', isPaypro: true }
const creditsWord = (n: number) => `${n} credit${n === 1 ? '' : 's'}`

export default function AddBankCredits({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [text, setText] = useState('')
  const [flips, setFlips] = useState<Record<number, boolean>>({})
  const [edits, setEdits] = useState<Record<number, Edit>>({})
  const [recorded, setRecorded] = useState<string[]>([])
  const [results, setResults] = useState<Record<string, SaveResult>>({})
  const [busy, setBusy] = useState(false)
  const [byHand, setByHand] = useState(false)
  const [hand, setHand] = useState(EMPTY_HAND)

  const onText = (v: string) => {
    setText(v)
    setFlips({})
    setEdits({})
    setResults({})
  }

  // Read as soon as text is pasted — no button.
  const parsed = useMemo(() => parseBankAlerts(text), [text])
  const credits: AlertCredit[] = useMemo(
    () =>
      parsed.map((c, i) => {
        const e = edits[i] ?? {}
        const typed = e.amount ? parseAmount(e.amount) : null
        return {
          ...c,
          date: c.date ?? (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null),
          amountPkr: c.amountPkr ?? (typed !== null && typed > 0 ? typed : null),
          reference: c.reference ?? (e.reference?.trim() || null),
          isPaypro: flips[i] ?? c.isPaypro,
        }
      }),
    [parsed, edits, flips],
  )

  // Which references are already saved.
  const refList = credits.map((c) => c.reference ?? '').filter((r) => refKey(r) !== '').join(',')
  useEffect(() => {
    if (!refList) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/admin/payments/settlement/credits?refs=${encodeURIComponent(refList)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { recorded: [] }))
        .then((d: { recorded?: string[] }) => setRecorded(d.recorded ?? []))
        .catch(() => {})
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [refList])

  const statuses = useMemo(() => planAlerts(credits, recorded), [credits, recorded])
  const resultOf = (c: AlertCredit) => (c.reference ? results[refKey(c.reference)] : undefined)
  const ready = credits.filter((c, i) => statuses[i].kind === 'ready' && !resultOf(c))

  const send = async (list: { date: string; time: string | null; amountPkr: number | string; senderName: string | null; senderBank: string | null; reference: string; note: string | null; isPaypro: boolean }[]) => {
    setBusy(true)
    const { ok, data } = await adminFetch<SaveResponse>('/api/admin/payments/settlement/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: list }),
    })
    setBusy(false)
    const got = data?.results ?? []
    if (got.length > 0) setResults((r) => ({ ...r, ...Object.fromEntries(got.map((g) => [refKey(g.reference), g])) }))
    const saved = got.filter((g) => g.ok).length
    if (saved > 0) {
      toast.success(`${creditsWord(saved)} saved.`)
      router.refresh()
    }
    if (!ok || saved < list.length) toast.error(data?.error ?? got.find((g) => !g.ok)?.error ?? 'That did not save. Please try again.')
    return saved
  }

  const savePasted = async () => {
    const n = ready.length
    if (n === 0) return
    const yes = await confirm({ title: `Credits can't be deleted after saving. Save ${creditsWord(n)}?`, confirmLabel: 'Save', cancelLabel: 'Cancel', destructive: false })
    if (!yes) return
    await send(
      ready.map((c) => ({
        date: c.date!,
        time: c.time,
        amountPkr: c.amountPkr!,
        senderName: c.senderName,
        senderBank: c.senderBank,
        reference: c.reference!,
        note: alertNote(c),
        isPaypro: c.isPaypro,
      })),
    )
  }

  const saveHand = async (e: FormEvent) => {
    e.preventDefault()
    const yes = await confirm({ title: "Credits can't be deleted after saving. Save 1 credit?", confirmLabel: 'Save', cancelLabel: 'Cancel', destructive: false })
    if (!yes) return
    const saved = await send([{ ...hand, time: hand.time || null, senderName: hand.senderName || null, senderBank: hand.senderBank || null, note: hand.note || null }])
    if (saved > 0) setHand(EMPTY_HAND)
  }

  const setEdit = (i: number, field: AlertField, v: string) => setEdits((e) => ({ ...e, [i]: { ...e[i], [field]: v } }))

  const card = (c: AlertCredit, i: number) => {
    const status = statuses[i]
    const result = resultOf(c)
    // The boxes follow what the READER missed, so a box does not vanish while it is typed in.
    const original = planAlerts([parsed[i]], [])[0]
    const missing = original.kind === 'unreadable' ? original.missing : []
    return (
      <li key={i} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-black text-tm-navy">{c.amountPkr !== null ? pkr(c.amountPkr) : 'Amount not read'}</p>
          {result ? (
            result.ok ? (
              <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>Saved</span>
            ) : (
              <span className={`${CHIP} bg-tm-bg text-gray-600`}>{result.duplicate ? 'Already saved' : 'Not saved'}</span>
            )
          ) : status.kind === 'saved' ? (
            <span className={`${CHIP} bg-tm-bg text-gray-600`}>{status.inPaste ? 'Already saved (same reference pasted twice)' : 'Already saved'}</span>
          ) : status.kind === 'unreadable' ? (
            <span className={`${CHIP} bg-tm-tint-red text-tm-red`}>{unreadableText(status.missing)}</span>
          ) : (
            <span className={`${CHIP} bg-tm-tint-navy text-tm-navy`}>Ready to save</span>
          )}
        </div>
        <p className="text-xs text-slate-700">
          {c.date ? formatDate(c.date) : 'Date not read'}
          {c.time ? ` · ${c.time}` : ''} · {c.senderName ?? 'Sender not read'}
          {c.senderBank ? ` · ${c.senderBank}` : ''}
        </p>
        <p className="break-all text-[11px] text-gray-600">
          {c.reference ? `Ref ${c.reference}` : 'Reference not read'}
          {c.senderAccountLast4 ? ` · sender account ending ${c.senderAccountLast4}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
          <span className="font-bold">{c.isPaypro ? 'PayPro payout' : 'Member’s bank transfer'}</span>
          {!result && status.kind !== 'saved' && (
            <button type="button" onClick={() => setFlips((f) => ({ ...f, [i]: !c.isPaypro }))} className="min-h-[44px] font-bold text-tm-red underline">
              Change to {c.isPaypro ? 'member’s bank transfer' : 'PayPro payout'}
            </button>
          )}
        </div>
        {result?.ok && <p className={`text-[11px] font-bold ${result.matched ? 'text-tm-green-deep' : 'text-tm-gold-ink'}`}>{result.match}</p>}
        {result && !result.ok && !result.duplicate && <p className="text-[11px] font-bold text-tm-red">{result.error}</p>}
        {!result && missing.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {missing.includes('date') && (
              <label>
                <span className={LABEL}>Date</span>
                <input type="date" value={edits[i]?.date ?? ''} onChange={(e) => setEdit(i, 'date', e.target.value)} className={INPUT} />
              </label>
            )}
            {missing.includes('amount') && (
              <label>
                <span className={LABEL}>Amount (Rs)</span>
                <input inputMode="decimal" value={edits[i]?.amount ?? ''} onChange={(e) => setEdit(i, 'amount', e.target.value)} className={INPUT} />
              </label>
            )}
            {missing.includes('reference') && (
              <label>
                <span className={LABEL}>Transaction reference</span>
                <input value={edits[i]?.reference ?? ''} onChange={(e) => setEdit(i, 'reference', e.target.value)} className={INPUT} />
              </label>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-black text-tm-navy">Add bank credit</p>
      {!byHand ? (
        <>
          <label className="block">
            <span className={LABEL}>Paste one or more Faysal Bank alerts</span>
            <textarea value={text} onChange={(e) => onText(e.target.value)} rows={7} className={`${INPUT} py-2`} autoFocus />
          </label>
          {text.trim() !== '' && credits.length === 0 && (
            <p className="text-[11px] font-bold text-tm-red" role="status">
              We could not find a bank alert in that text. Paste the whole alert email, from &ldquo;Dear TUTOR MINT&rdquo; to the Transaction Reference.
            </p>
          )}
          {credits.length > 0 && <ul className="space-y-2">{credits.map(card)}</ul>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void savePasted()} disabled={busy || ready.length === 0} className={BUTTON}>
              {busy ? 'Saving…' : `Save ${creditsWord(ready.length)}`}
            </button>
            <button type="button" onClick={onClose} className={GHOST}>
              Close
            </button>
            <button type="button" onClick={() => setByHand(true)} className="min-h-[44px] text-[11px] font-bold text-tm-red underline">
              Enter by hand instead
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={saveHand} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={LABEL}>Date</span>
              <input type="date" required value={hand.date} onChange={(e) => setHand({ ...hand, date: e.target.value })} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>Time</span>
              <input type="time" value={hand.time} onChange={(e) => setHand({ ...hand, time: e.target.value })} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>Amount (Rs)</span>
              <input required inputMode="decimal" value={hand.amountPkr} onChange={(e) => setHand({ ...hand, amountPkr: e.target.value })} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>Transaction reference</span>
              <input required value={hand.reference} onChange={(e) => setHand({ ...hand, reference: e.target.value })} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>Sender name</span>
              <input
                value={hand.senderName}
                onChange={(e) => setHand({ ...hand, senderName: e.target.value, isPaypro: e.target.value.trim() ? isPayproSender(e.target.value) : hand.isPaypro })}
                className={INPUT}
              />
            </label>
            <label>
              <span className={LABEL}>Sender bank (optional)</span>
              <input value={hand.senderBank} onChange={(e) => setHand({ ...hand, senderBank: e.target.value })} className={INPUT} />
            </label>
            <label className="col-span-2">
              <span className={LABEL}>Note (optional)</span>
              <input value={hand.note} onChange={(e) => setHand({ ...hand, note: e.target.value })} className={INPUT} maxLength={500} />
            </label>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={hand.isPaypro} onChange={(e) => setHand({ ...hand, isPaypro: e.target.checked })} />
            This is a PayPro payout (untick for a member&rsquo;s own bank transfer)
          </label>
          {results[refKey(hand.reference)]?.ok === false && <p className="text-[11px] font-bold text-tm-red">{results[refKey(hand.reference)].error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? 'Saving…' : 'Save bank credit'}
            </button>
            <button type="button" onClick={onClose} className={GHOST}>
              Close
            </button>
            <button type="button" onClick={() => setByHand(false)} className="min-h-[44px] text-[11px] font-bold text-tm-red underline">
              Paste a bank alert instead
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
