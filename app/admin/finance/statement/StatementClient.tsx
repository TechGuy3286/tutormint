'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Upload } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import LinkBankCredit from '@/components/admin/LinkBankCredit'
import MemberNameLink from '@/components/admin/MemberNameLink'
import AdminAvatar from '@/components/admin/AdminAvatar'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { CLASS_LABEL, STATEMENT_CLASSES, type StatementClass } from '@/lib/bankStatementCore'
import type { BoardRow, ImportOutcome, StatementBoard } from '@/lib/bankStatement'
import { pkr } from '@/lib/reconciliationCore'

// Finance → Import bank statement — the Owner's screen (PR-03). Every action
// goes to /api/admin/finance/statement, which re-checks Owner only. The
// view-only Partner sees the same lists with no buttons.

type Settlement = { date: string; amount: number; units: number | null; fee: number | null; covered: number; bankCharge: number }

const card = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5'
const btn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const btnPrimary = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const th = 'p-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500'
const td = 'p-2 text-xs text-slate-700 align-top'

function dayLabel(d: string, t?: string | null): string {
  const [y, m, dd] = d.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return t ? `${s} ${t}` : s
}

function RowLine({ row }: { row: BoardRow }) {
  return (
    <span>
      <span className="font-bold text-tm-navy">{pkr(row.deposit || row.withdrawal)}</span> · {dayLabel(row.date, row.time)}
      {row.sender ? ` · ${row.sender}` : ''}
      {row.account ? ` · ${row.account}` : ''}
    </span>
  )
}

// A member with their picture (PR-04): the default + No photo tag when none.
function Who({ id, name, avatars }: { id: string; name: string; avatars?: Record<string, { src: string | null; gender: string | null }> }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <AdminAvatar name={name} src={avatars?.[id]?.src ?? null} gender={avatars?.[id]?.gender ?? null} className="h-6 w-6 text-[9px]" px={24} />
      <MemberNameLink id={id} name={name} />
    </span>
  )
}

export default function StatementClient({ board, settlements }: { board: StatementBoard; settlements: Settlement[] }) {
  const owner = useCanApprove()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [filter, setFilter] = useState<StatementClass | 'all' | 'personal'>('all')
  const [linking, setLinking] = useState<{ rowId: string; transferId?: string; member?: { id: string; name: string } } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string | null>>({})

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    const r = await adminFetch<{ error?: string; value?: string | null }>('/api/admin/finance/statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!r.ok) toast.error(r.data?.error ?? 'That did not save. Please try again.')
    return r
  }

  const upload = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    setBusy(true)
    const r = await adminFetch<{ error?: string; outcome?: ImportOutcome }>('/api/admin/finance/statement', { method: 'POST', body: fd })
    setBusy(false)
    if (r.ok && r.data?.outcome) {
      setOutcome(r.data.outcome)
      toast.success(`Statement imported: ${r.data.outcome.rowsNew} new rows, ${r.data.outcome.rowsDuplicate} already saved.`)
      router.refresh()
    } else toast.error(r.data?.error ?? 'The statement could not be imported.')
  }

  const reclassify = async (row: BoardRow, to: StatementClass) => {
    const r = await post({ action: 'reclassify', rowId: row.id, to })
    if (r.ok) {
      toast.success(`Changed to ${CLASS_LABEL[to]}.`, { label: 'Undo', ms: 10_000, onClick: () => void post({ action: 'undo_class', rowId: row.id }).then(() => router.refresh()) })
      router.refresh()
    }
  }

  const personal = async (row: BoardRow) => {
    const note = window.prompt('Why is this not business money? (e.g. owner transfer, loan, cheque deposit)')
    if (note == null) return
    if (note.trim().length < 3) return toast.error('Add a short note.')
    const r = await post({ action: 'personal', rowId: row.id, note: note.trim() })
    if (r.ok) {
      toast.success('Marked "Not business (personal)". It is left out of every total.', { label: 'Undo', ms: 10_000, onClick: () => void post({ action: 'undo_personal', rowId: row.id }).then(() => router.refresh()) })
      router.refresh()
    }
  }

  const undoPersonal = async (row: BoardRow) => {
    const r = await post({ action: 'undo_personal', rowId: row.id })
    if (r.ok) {
      toast.success('It counts again.')
      router.refresh()
    }
  }

  const reveal = async (row: BoardRow) => {
    const ok = await confirm({ title: 'Show the full number?', body: 'Showing it is recorded in the audit log.', confirmLabel: 'Show' })
    if (!ok) return
    const r = await post({ action: 'reveal', rowId: row.id })
    if (r.ok) setRevealed((v) => ({ ...v, [row.id]: r.data?.value ?? '—' }))
  }

  const addAsNew = async (row: BoardRow) => {
    const ok = await confirm({ title: 'Add as a new credit?', body: 'This counts it as NEW money in the bank totals. Only do this if it is a different payment from the credit already recorded.', confirmLabel: 'Add as new money', destructive: true })
    if (!ok) return
    const r = await post({ action: 'resolve', rowId: row.id, transferId: null })
    if (r.ok) {
      toast.success('Added as a new bank credit.')
      router.refresh()
    }
  }

  // PR-04: Link a statement credit to an approved payment, with Undo.
  const linkApproved = async (row: BoardRow, paymentId: string) => {
    const r = await post({ action: 'link_approved', rowId: row.id, paymentId })
    if (r.ok) {
      toast.success('Bank credit linked to the payment.', { label: 'Undo', ms: 10_000, onClick: () => void post({ action: 'unlink', rowId: row.id }).then(() => router.refresh()) })
      router.refresh()
    }
  }

  const unlink = async (row: BoardRow) => {
    const ok = await confirm({ title: 'Undo this link?', body: 'The credit and the payment go back to unlinked. This pair will not be linked automatically again.', confirmLabel: 'Undo link' })
    if (!ok) return
    const r = await post({ action: 'unlink', rowId: row.id })
    if (r.ok) {
      toast.success('Link undone.')
      router.refresh()
    }
  }

  // "Same money — link": no new money is added.
  const sameMoney = async (row: BoardRow, transferId: string) => {
    const r = await post({ action: 'same_money', rowId: row.id, transferId })
    if (r.ok) {
      toast.success('Linked to the credit already recorded. Nothing was added.', { label: 'Undo', ms: 10_000, onClick: () => void post({ action: 'undo_same', rowId: row.id }).then(() => router.refresh()) })
      router.refresh()
    }
  }

  // Assign on a row with no bank credit yet: the credit is made first.
  const startAssign = async (row: BoardRow, memberPick?: { id: string; name: string }) => {
    if (row.transferId) return setLinking({ rowId: row.id, transferId: row.transferId, member: memberPick })
    const r = await adminFetch<{ error?: string; transferId?: string }>('/api/admin/finance/statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ensure_credit', rowId: row.id }),
    })
    if (r.ok && r.data?.transferId) setLinking({ rowId: row.id, transferId: r.data.transferId, member: memberPick })
    else toast.error(r.data?.error ?? 'That did not save. Please try again.')
  }

  const rows = useMemo(
    () => board.rows.filter((r) => (filter === 'all' ? true : filter === 'personal' ? !!r.personalAt : r.cls === filter && !r.personalAt)),
    [board.rows, filter],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: board.rows.length, personal: 0 }
    for (const r of board.rows) {
      if (r.personalAt) c.personal++
      else c[r.cls] = (c[r.cls] ?? 0) + 1
    }
    return c
  }, [board.rows])

  const credit = (row: BoardRow, transferId?: string) => ({ id: transferId ?? row.transferId!, date: row.date, time: row.time, amountPkr: row.deposit, reference: null, senderName: row.sender })

  const linker = (row: BoardRow) =>
    linking?.rowId === row.id && (linking.transferId ?? row.transferId) ? (
      <div className="mt-2">
        <LinkBankCredit credit={credit(row, linking.transferId)} initialMember={linking.member} onCancel={() => setLinking(null)} />
      </div>
    ) : null

  const last = outcome ?? null

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- import */}
      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">Import bank statement</h2>
        {owner ? (
          <label className={`${btnPrimary} cursor-pointer`}>
            <Upload aria-hidden size={14} />
            {busy ? 'Working…' : 'Choose the statement file'}
            <input
              type="file"
              accept=".xls,.html,.htm,text/html,application/vnd.ms-excel"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void upload(f)
              }}
            />
          </label>
        ) : (
          <p className="text-xs text-gray-500">View only. The Owner imports statements.</p>
        )}
        {last && (
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-tm-bg p-3 text-[11px] sm:grid-cols-4" data-import-summary="">
            <div><dt className="text-gray-500">New rows</dt><dd className="font-bold">{last.rowsNew}</dd></div>
            <div><dt className="text-gray-500">Already saved (skipped)</dt><dd className="font-bold">{last.rowsDuplicate}</dd></div>
            <div><dt className="text-gray-500">Credits</dt><dd className="font-bold">{pkr(last.totalCredits)}</dd></div>
            <div><dt className="text-gray-500">Debits</dt><dd className="font-bold">{pkr(last.totalDebits)}</dd></div>
            <div><dt className="text-gray-500">Closing balance (file)</dt><dd className="font-bold">{pkr(last.closingBalanceFile)}</dd></div>
            <div><dt className="text-gray-500">Closing balance (worked out)</dt><dd className="font-bold">{pkr(last.closingBalanceComputed)}</dd></div>
            <div className="col-span-2">
              <dt className="text-gray-500">Balance check</dt>
              <dd className={`font-bold ${last.balanceMatches === false ? 'text-tm-red' : 'text-tm-green-deep'}`}>
                {last.balanceMatches === null ? 'Not available' : last.balanceMatches ? 'Matches the statement ✓' : 'Does not match — check the file is complete'}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-4 text-gray-500">
              Bank credits: {last.creditsAdded} added, {last.creditsLinked} matched to credits already recorded, {last.creditsUnclear} need a check below.
            </div>
          </dl>
        )}
        {board.imports.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className={th}>Imported</th>
                  <th className={th}>Dates</th>
                  <th className={`${th} text-right`}>New / skipped</th>
                  <th className={`${th} text-right`}>Credits</th>
                  <th className={`${th} text-right`}>Debits</th>
                  <th className={th}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {board.imports.map((i) => (
                  <tr key={i.id} className="border-b border-gray-100 last:border-0">
                    <td className={td}>{new Date(i.createdAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{i.byName ? ` · ${i.byName}` : ''}</td>
                    <td className={td}>{i.periodFrom ? `${dayLabel(i.periodFrom)} – ${dayLabel(i.periodTo ?? i.periodFrom)}` : '—'}</td>
                    <td className={`${td} text-right`}>{i.rowsNew} / {i.rowsDuplicate}</td>
                    <td className={`${td} text-right`}>{pkr(i.totalCredits)}</td>
                    <td className={`${td} text-right`}>{pkr(i.totalDebits)}</td>
                    <td className={`${td} font-bold ${i.closingFile !== null && i.closingComputed !== null && Math.abs(i.closingFile - i.closingComputed) >= 0.01 ? 'text-tm-red' : 'text-tm-green-deep'}`}>
                      {i.closingFile === null || i.closingComputed === null ? '—' : Math.abs(i.closingFile - i.closingComputed) < 0.01 ? 'Matches ✓' : 'Differs'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ lists */}
      <section className={card} id="bank-matched">
        <h2 className="text-sm font-black text-tm-navy">Bank-matched receipts ({board.lists.bankMatched.length})</h2>
        <p className="text-[11px] text-gray-500">A bank credit matches a receipt waiting for approval. Approve it on Payments; staff who may approve bank-matched receipts can approve it in one click.</p>
        {board.lists.bankMatched.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {board.lists.bankMatched.map((m) => (
              <li key={m.row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <RowLine row={m.row} />
                  <div className="text-gray-500">
                    {m.memberId ? <Who id={m.memberId} name={m.memberName ?? 'Member'} avatars={board.avatars} /> : m.memberName ?? 'Member'} · {m.paymentRef} · <span className="font-bold text-tm-green-deep">{m.reason}</span>
                  </div>
                </div>
                <a href={`/admin/payments?search=${encodeURIComponent(m.paymentRef)}`} className={btn}>Open in Payments</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} id="not-recorded">
        <h2 className="text-sm font-black text-tm-navy">Paid in bank, not recorded ({board.lists.paidNotRecorded.length})</h2>
        <p className="text-[11px] text-gray-500">The money came from a member who has no payment on TutorMint. Record it to give them what they paid for.</p>
        {board.lists.paidNotRecorded.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {board.lists.paidNotRecorded.map((m) => (
              <li key={m.row.id} className="py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <RowLine row={m.row} />
                    <div className="text-gray-500">
                      <Who id={m.memberId} name={m.memberName ?? 'Member'} avatars={board.avatars} /> · <span className="font-bold text-tm-green-deep">{m.reason}</span>
                    </div>
                  </div>
                  {owner && m.row.transferId && (
                    <button type="button" className={btnPrimary} disabled={busy} onClick={() => setLinking({ rowId: m.row.id, member: { id: m.memberId, name: m.memberName ?? 'Member' } })}>
                      Record bank payment
                    </button>
                  )}
                </div>
                {linker(m.row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} id="unmatched">
        <h2 className="text-sm font-black text-tm-navy">Unmatched credits ({board.lists.unmatched.length})</h2>
        <p className="text-[11px] text-gray-500">A fee-sized credit with no member found. Assign it to a member, or mark it as not a fee.</p>
        {board.lists.unmatched.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {board.lists.unmatched.map((m) => (
              <li key={m.row.id} className="py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <RowLine row={m.row} />
                    {m.note && <div className="text-gray-500">{m.note}{m.candidates.length > 0 ? ' — pick the right one:' : ''}</div>}
                    {m.candidates.length > 0 && (
                      <ul className="mt-1 space-y-1" data-candidates="">
                        {m.candidates.map((c) => (
                          <li key={c.id} className="flex flex-wrap items-center gap-2">
                            <Who id={c.id} name={c.name} avatars={board.avatars} />
                            {c.mobile && <span className="text-gray-500">{c.mobile}</span>}
                            {owner && (
                              <button type="button" className="text-[11px] font-bold text-tm-navy underline" disabled={busy} onClick={() => void startAssign(m.row, { id: c.id, name: c.name })}>
                                Pick this account
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {owner && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn} disabled={busy} onClick={() => void startAssign(m.row)}>
                        Assign to a member
                      </button>
                      <button type="button" className={btn} disabled={busy} onClick={() => void reclassify(m.row, 'other_credit')}>
                        Not a fee
                      </button>
                    </div>
                  )}
                </div>
                {linker(m.row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} id="approved-no-credit">
        <h2 className="text-sm font-black text-tm-navy">Approved, no bank credit ({board.lists.approvedNoCredit.length})</h2>
        <p className="text-[11px] text-gray-500">Bank-transfer payments approved on TutorMint inside the statement dates with no bank credit linked. Check each one.</p>
        {board.lists.approvedNoCredit.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {board.lists.approvedNoCredit.map((a) => (
              <li key={a.paymentId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <span className="font-bold text-tm-navy">{pkr(a.amount)}</span> · {a.paymentRef} ·{' '}
                  {a.memberId ? <Who id={a.memberId} name={a.memberName ?? 'Member'} avatars={board.avatars} /> : a.memberName ?? 'Deleted account'} ·{' '}
                  approved {new Date(a.approvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })}
                  {a.suggestions.length === 0 ? (
                    <div className="text-gray-500">No statement credit of this amount within 2 days.</div>
                  ) : (
                    <ul className="mt-1 space-y-1" data-likely-credits="">
                      {a.suggestions.slice(0, 4).map((s, i) => (
                        <li key={s.row.id} className="flex flex-wrap items-center gap-2 text-gray-500">
                          <span>
                            {i === 0 ? 'Likely credit' : 'Or'}: <RowLine row={s.row} /> · <span className="font-bold text-tm-green-deep">{s.reason}</span>
                          </span>
                          {owner && s.row.transferId && (
                            <button type="button" className={i === 0 ? btnPrimary : btn} disabled={busy} onClick={() => void linkApproved(s.row, a.paymentId)}>
                              Link
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {board.unclear.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-black text-tm-navy">Check: possibly already recorded ({board.unclear.length})</h2>
          <p className="text-[11px] text-gray-500">
            A bank credit of the same amount that day is already recorded, so these were not added. Usually it is the same money: link it. Add one only if it
            is a different payment — that counts new money.
          </p>
          <ul className="divide-y divide-gray-100">
            {board.unclear.map((row) => (
              <li key={row.id} className="space-y-1 py-2 text-xs" data-unclear-row="">
                <RowLine row={row} />
                {row.duplicates.length === 0 ? (
                  <p className="text-gray-500">The recorded credit is already tied to another statement row.</p>
                ) : (
                  <ul className="space-y-1">
                    {row.duplicates.map((d, i) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 text-gray-500">
                        <span>
                          Recorded: <span className="font-bold text-tm-navy">{pkr(d.amount)}</span> · {dayLabel(d.date, d.time)}
                          {d.sender ? ` · ${d.sender}` : ''} · {d.source === 'email' ? 'from the bank email' : 'entered by hand'}
                        </span>
                        {owner && (
                          <button type="button" className={i === 0 ? btnPrimary : btn} disabled={busy} onClick={() => void sameMoney(row, d.id)}>
                            Same money — link
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {owner && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => void addAsNew(row)}>
                      Add as a new credit
                    </button>
                    <span className="text-[11px] font-bold text-tm-gold-ink">Adding counts it as new money.</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {board.lists.autoLinked.length > 0 && (
        <section className={card} id="auto-linked">
          <h2 className="text-sm font-black text-tm-navy">Linked automatically ({board.lists.autoLinked.length})</h2>
          <p className="text-[11px] text-gray-500">
            The only credit of that amount within 2 days, and the only payment it could be — so they were linked. Undo if one is wrong; it will not be linked
            again.
          </p>
          <ul className="divide-y divide-gray-100">
            {board.lists.autoLinked.map((l) => (
              <li key={l.row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <RowLine row={l.row} />
                  <div className="text-gray-500">
                    {l.memberId ? <Who id={l.memberId} name={l.memberName ?? 'Member'} avatars={board.avatars} /> : (l.memberName ?? 'Member')} · {l.paymentRef}
                  </div>
                </div>
                {owner && (
                  <button type="button" className={btn} disabled={busy} onClick={() => void unlink(l.row)}>
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------- PayPro settlements */}
      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">PayPro settlements</h2>
        <p className="text-[11px] text-gray-500">Each settlement of N × Rs 193 covers N payments of Rs 199 — PayPro’s fee is Rs 6 a payment. Settlements are matched to PayPro payments by date and count.</p>
        {settlements.length === 0 ? (
          <p className="text-xs text-gray-500">No PayPro settlement recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Payments</th>
                  <th className={`${th} text-right`}>Fee each</th>
                  <th className={`${th} text-right`}>Matched</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className={td}>{dayLabel(s.date)}</td>
                    <td className={`${td} text-right`}>{pkr(s.amount)}{s.bankCharge ? ' (Rs 1 bank charge)' : ''}</td>
                    <td className={`${td} text-right`}>{s.units ?? 'Not a multiple of 193'}</td>
                    <td className={`${td} text-right`}>{s.fee === null ? '—' : pkr(s.fee)}</td>
                    <td className={`${td} text-right ${s.units !== null && s.covered < s.units ? 'font-bold text-tm-red' : ''}`}>{s.covered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- all rows */}
      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">All statement rows</h2>
        <div className="flex flex-wrap gap-2">
          {(['all', ...STATEMENT_CLASSES, 'personal'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`min-h-[36px] rounded-full border px-3 text-[11px] font-bold ${filter === k ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700'}`}
            >
              {k === 'all' ? 'All' : k === 'personal' ? 'Personal, excluded' : CLASS_LABEL[k]} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
        <ul className="divide-y divide-gray-100">
          {rows.slice(0, 300).map((row) => (
            <li key={row.id} className={`space-y-1 py-2 text-xs ${row.personalAt ? 'text-gray-500' : ''}`} data-row-class={row.cls}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className={`font-bold ${row.deposit > 0 ? 'text-tm-green-deep' : 'text-tm-red'}`}>
                    {row.deposit > 0 ? '+' : '−'}
                    {pkr(row.deposit || row.withdrawal)}
                  </span>{' '}
                  · {dayLabel(row.date, row.time)} · {row.type ?? ''} · {row.clsLabel}
                  {row.clsAuto !== row.cls ? ' (changed)' : ''}
                </span>
                <span className="text-gray-500">
                  {row.sender ?? ''}
                  {row.account && (
                    <>
                      {' '}
                      · {revealed[row.id] ?? row.account}
                      {owner && revealed[row.id] === undefined && (
                        <button type="button" onClick={() => void reveal(row)} className="ml-1 inline-flex items-center gap-0.5 font-bold text-tm-navy underline">
                          <Eye aria-hidden size={12} />
                          Show
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
              <p className="break-words text-[11px] text-gray-500">{row.description}</p>
              {row.personalAt && <p className="text-[11px] text-gray-500">Personal, excluded{row.personalNote ? ` — ${row.personalNote}` : ''}</p>}
              {row.suggestPersonal && <p className="text-[11px] font-bold text-tm-gold-ink">Large non-fee credit — is it personal money (owner or partner transfer, loan, cheque)?</p>}
              {owner && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`cls-${row.id}`}>Type</label>
                  <select
                    id={`cls-${row.id}`}
                    value={row.cls}
                    disabled={busy}
                    onChange={(e) => void reclassify(row, e.target.value as StatementClass)}
                    className="min-h-[36px] rounded-lg border border-gray-200 bg-white px-2 text-[11px]"
                  >
                    {(row.deposit > 0 ? (['fee', 'paypro', 'other_credit'] as const) : (['debit'] as const)).map((c) => (
                      <option key={c} value={c}>{CLASS_LABEL[c]}</option>
                    ))}
                  </select>
                  {row.canUndoClass && (
                    <button type="button" className="text-[11px] font-bold text-tm-navy underline" disabled={busy} onClick={() => void post({ action: 'undo_class', rowId: row.id }).then(() => router.refresh())}>
                      Undo type change
                    </button>
                  )}
                  {row.personalAt ? (
                    <button type="button" className="text-[11px] font-bold text-tm-navy underline" disabled={busy} onClick={() => void undoPersonal(row)}>
                      Undo personal mark
                    </button>
                  ) : (
                    <button type="button" className="text-[11px] font-bold text-slate-700 underline" disabled={busy} onClick={() => void personal(row)}>
                      Not business (personal)
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {rows.length > 300 && <p className="text-[11px] text-gray-500">Showing the newest 300 of {rows.length}.</p>}
      </section>
    </div>
  )
}
