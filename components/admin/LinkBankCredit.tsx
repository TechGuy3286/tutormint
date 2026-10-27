'use client'

// Link a bank credit to a member (owner, 20 Oct 2026).
//
// Two entry points, one form:
//   • on an unmatched bank credit (Finance → Settlement check): "Link to member"
//     — search for the member, pick what it paid for;
//   • on the member page under Payments: "Record a bank payment" — pick one of
//     the unmatched bank credits, so a payment is never recorded without a real
//     credit behind it.
// The member-page picker (owner, 27 Oct 2026) offers only unlinked credits up
// to Rs 5,000, never PayPro payouts; the selected amount's credits come first;
// "+ Add a credit" opens the Finance add form inline.
// The amount is pre-filled from the credit. Owner only: the server refuses
// everyone else (/api/admin/payments/bank-link); here it simply does not render.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Plus, UserPlus } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import { sortPickerCredits } from '@/lib/bankPaymentLinkCore'
import { refKey } from '@/lib/settlementMatchCore'
import { alreadyPaidOption, type ExistingFee } from '@/lib/feeMatchCore'
import AlreadyPaidOptions from '@/components/admin/AlreadyPaidOptions'
import AddBankCredits from '@/app/admin/finance/settlement/AddBankCredits'

const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'

type Credit = {
  id: string
  date: string
  time: string | null
  amountPkr: number
  reference: string | null
  senderName: string | null
  /** Set when the credit is matched AUTOMATICALLY to these bank-transfer
   *  receipts (TM references); linking replaces that match (21 Oct 2026). */
  replacesReceipts?: string[]
}
type Member = { id: string; name: string; role: string; city: string | null; joined: string }
type Plan = { code: string; name: string; pricePkr: number }

const replacesLine = (c: Credit | null) =>
  c?.replacesReceipts && c.replacesReceipts.length > 0
    ? `Now matched automatically to bank transfer ${c.replacesReceipts.join(', ')}. Linking replaces that match, and that receipt goes back to waiting for its own bank credit.`
    : null

const creditLine = (c: Credit) =>
  `${pkr(c.amountPkr)} · ${formatDate(c.date)}${c.time ? ` ${c.time}` : ''} · ${c.senderName ?? 'Sender not recorded'}${c.reference ? ` · ref ${c.reference}` : ''}${
    c.replacesReceipts && c.replacesReceipts.length > 0 ? ` · now matched automatically to ${c.replacesReceipts.join(', ')}` : ''
  }`

export default function LinkBankCredit(
  props:
    | {
        credit: Credit
        /** Finance → Link (21 Oct 2026): the member was already picked in the
         *  one search; the form opens straight on what it paid for. */
        initialMember?: { id: string; name: string }
        onCancel?: () => void
      }
    | { member: { id: string; name: string } },
) {
  const canApprove = useCanApprove()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const fixedCredit = 'credit' in props ? props.credit : null
  const fixedMember = 'member' in props ? props.member : null
  const initialMember = 'credit' in props ? (props.initialMember ?? null) : null
  const onCancel = 'credit' in props ? props.onCancel : undefined

  const [open, setOpen] = useState(!!initialMember)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Member[]>([])
  const [member, setMember] = useState<{ id: string; name: string } | null>(fixedMember ?? initialMember)
  const [credits, setCredits] = useState<Credit[] | null>(null)
  const [creditId, setCreditId] = useState<string | null>(fixedCredit?.id ?? null)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [planCode, setPlanCode] = useState('')
  const [amount, setAmount] = useState(fixedCredit ? String(fixedCredit.amountPkr) : '')
  // "+ Add a credit" (owner, 27 Oct 2026): the Finance add form, inline; when it
  // saves, the list reloads and the new credit is selected.
  const [adding, setAdding] = useState(false)
  const [reload, setReload] = useState(0)
  const [wantRef, setWantRef] = useState<string | null>(null)
  // "This member has already paid this fee" (owner, 27 Oct 2026): the existing
  // fee payment, to link this credit to it or mark this one refund due.
  const [existing, setExisting] = useState<ExistingFee | null>(null)

  const credit = fixedCredit ?? credits?.find((c) => c.id === creditId) ?? null
  const selectedPrice = plans?.find((p) => p.code === planCode)?.pricePkr ?? null
  // Unlinked credits only (the server already filtered); the selected amount on top, then newest.
  const shown = credits ? sortPickerCredits(credits, selectedPrice) : null

  // Member search (from a credit).
  useEffect(() => {
    if (!open || fixedMember || member || q.trim().length < 2) {
      setFound([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/payments/bank-link?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        const d = (await res.json().catch(() => ({}))) as { members?: Member[] }
        setFound(d.members ?? [])
      } catch {
        /* a newer keystroke cancelled it */
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, open, member, fixedMember])

  // Once the member is known: what it could be for, and the unmatched credits.
  useEffect(() => {
    if (!open || !member) return
    let live = true
    void (async () => {
      const res = await fetch(`/api/admin/payments/bank-link?memberId=${member.id}`)
      const d = (await res.json().catch(() => ({}))) as { plans?: Plan[]; credits?: Credit[]; error?: string }
      if (!live) return
      if (!res.ok) {
        toast.error(d.error ?? 'That did not load. Please try again.')
        return
      }
      setPlans(d.plans ?? [])
      setCredits(d.credits ?? [])
      setPlanCode((cur) => cur || (d.plans?.[0]?.code ?? ''))
      if (wantRef) {
        const added = (d.credits ?? []).find((c) => c.reference && refKey(c.reference) === refKey(wantRef))
        if (added) {
          setCreditId(added.id)
          setAmount(String(added.amountPkr))
        }
        setWantRef(null)
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is a stable API; re-running on it would loop
  }, [open, member, reload])

  if (!canApprove) return null

  const reset = () => {
    onCancel?.()
    setOpen(false)
    setQ('')
    setFound([])
    setMember(fixedMember)
    setPlans(null)
    setPlanCode('')
    if (!fixedCredit) {
      setCreditId(null)
      setAmount('')
    }
  }

  const pickCredit = (c: Credit) => {
    setCreditId(c.id)
    setAmount(String(c.amountPkr))
  }

  const save = async () => {
    const plan = plans?.find((p) => p.code === planCode)
    const value = Number(amount)
    if (!member || !credit || !plan || !(value > 0)) {
      toast.error('Choose the member, the bank credit and what it paid for.')
      return
    }
    const ok = await confirm({
      title: 'Record this bank payment?',
      body: `${pkr(value)} for ${plan.name}, paid by ${member.name}, from the bank credit of ${formatDate(credit.date)}. It counts as an approved payment on that date and the member is sent a receipt.${replacesLine(credit) ? ` ${replacesLine(credit)}` : ''}`,
      confirmLabel: 'Record payment',
      destructive: false,
    })
    if (!ok) return
    setBusy(true)
    setExisting(null)
    const { ok: done, data } = await adminFetch<{ error?: string; reference?: string; mode?: string; existing?: ExistingFee | null }>('/api/admin/payments/bank-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId: credit.id, memberId: member.id, planCode: plan.code, amountPkr: value }),
    })
    setBusy(false)
    if (!done) {
      if (data?.existing) setExisting(data.existing)
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(
      data?.mode === 'attach'
        ? `Payment ${data.reference} recorded and attached to the badge or plan they already had.`
        : `Payment ${data?.reference ?? ''} recorded and approved.`,
    )
    reset()
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={GHOST}>
        {fixedCredit ? <UserPlus aria-hidden size={14} /> : <Landmark aria-hidden size={14} />}
        {fixedCredit ? 'Link to member' : 'Record a bank payment'}
      </button>
    )
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
      <p className="text-xs font-bold text-tm-navy">{fixedCredit ? 'Who paid this, and for what?' : 'Record a payment from a bank credit'}</p>

      {replacesLine(fixedCredit) && <p className="text-[11px] font-bold text-tm-gold-ink">{replacesLine(fixedCredit)}</p>}

      {!fixedMember &&
        (member ? (
          <p className="text-xs text-slate-700">
            Member: <span className="font-bold">{member.name}</span>{' '}
            <button type="button" onClick={() => setMember(null)} className="font-bold text-tm-red underline">
              Change
            </button>
          </p>
        ) : (
          <div className="space-y-1">
            <label className="block">
              <span className={LABEL}>Find the member (name, email or mobile)</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} autoFocus />
            </label>
            {found.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {found.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setMember({ id: m.id, name: m.name })}
                      className="min-h-[40px] w-full rounded-lg bg-white px-2 text-left text-xs text-slate-700 hover:bg-tm-tint-navy"
                    >
                      <span className="font-bold">{m.name}</span> · {m.role === 'tutor' ? 'Tutor' : 'Parent'}
                      {m.city ? ` · ${m.city}` : ''} · joined {formatDate(m.joined)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {member && !fixedCredit && shown && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={LABEL}>Which bank credit?</span>
            {!adding && (
              <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-[32px] items-center gap-1 text-[11px] font-bold text-tm-red hover:underline">
                <Plus aria-hidden size={12} /> Add a credit
              </button>
            )}
          </div>
          {adding && (
            <div className="rounded-xl border border-gray-200 bg-white p-2">
              <AddBankCredits
                memberPayment
                onClose={() => setAdding(false)}
                onSaved={(refs) => {
                  setAdding(false)
                  setWantRef(refs[0] ?? null)
                  setReload((n) => n + 1)
                }}
              />
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-[11px] text-gray-600">No unlinked bank credit up to Rs 5,000. Use &ldquo;Add a credit&rdquo; to enter it.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {shown.map((c) => (
                <label key={c.id} className="flex min-h-[36px] items-center gap-2 break-all text-[11px] text-slate-700">
                  <input type="radio" name="bank-credit" checked={creditId === c.id} onChange={() => pickCredit(c)} />
                  {creditLine(c)}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {member && plans && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>What it paid for</span>
            <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className={INPUT}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} ({pkr(p.pricePkr)})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Amount (Rs)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className={INPUT} />
          </label>
        </div>
      )}

      {existing && member && credit && (
        <AlreadyPaidOptions
          existing={existing}
          option={alreadyPaidOption(existing)}
          transferId={credit.id}
          memberId={member.id}
          memberName={member.name}
          creditAmountPkr={credit.amountPkr}
          onDone={() => {
            setExisting(null)
            reset()
            router.refresh()
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !member || !credit || !planCode} onClick={() => void save()} className={BUTTON}>
          {busy ? 'Saving…' : 'Record payment'}
        </button>
        <button type="button" onClick={reset} className={GHOST}>
          Cancel
        </button>
      </div>
    </div>
  )
}
