'use client'

import { useState } from 'react'
import Link from 'next/link'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { HoldRow, ListRow, SearchResult, MatchVia } from '@/lib/contactWithdraw'
import { CONSENT_UI_ENABLED } from '@/lib/tuitionConsentCore'

const VIA_WORDS: Record<MatchVia, string> = {
  contact_phone: 'Parent contact number',
  contact_whatsapp: 'Parent WhatsApp',
  contact_text: 'Contact notes',
  tuition_text: 'Written in the tuition',
  parent_account: "Parent account's own number",
}

const LEAD_WORDS: Record<string, string> = {
  legacy_parent_profiles: 'Imported parent leads',
  legacy_parents: 'Imported parents',
  legacy_tutors: 'Imported tutors',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

export default function WithdrawContactClient({
  initialList,
  initialHolds,
  report,
}: {
  initialList: ListRow[]
  initialHolds: HoldRow[]
  report: { staff: string; count: number }[]
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [phone, setPhone] = useState('')
  const [searched, setSearched] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [reason, setReason] = useState('Person says they never posted; asked for removal')
  const [list, setList] = useState(initialList)
  const [holds, setHolds] = useState(initialHolds)

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    const { ok, data } = await adminFetch<{ result?: SearchResult; error?: string }>('/api/admin/contact-withdraw/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    setBusy(false)
    if (!ok || !data.result) {
      toast.error(data.error ?? 'The search did not finish.')
      return
    }
    setResult(data.result)
    setSearched(phone)
  }

  async function refreshList() {
    const { ok, data } = await adminFetch<{ list?: ListRow[] }>('/api/admin/contact-withdraw/list')
    if (ok && data.list) setList(data.list)
  }

  async function refreshHolds() {
    const { ok, data } = await adminFetch<{ holds?: HoldRow[] }>('/api/admin/contact-withdraw/unpause')
    if (ok && data.holds) setHolds(data.holds)
  }

  // "Pause all their tuitions" (owner, 27 Oct 2026) — the reversible default.
  async function pauseAll() {
    if (!result) return
    const n = result.tuitions.filter((t) => t.willClose && !t.alreadyWithdrawn && !t.pausedOnComplaint).length
    const yes = await confirm({
      title: `Pause all tuitions using ${result.masked}?`,
      body: `${n} tuition${n === 1 ? '' : 's'} will be paused: hidden from Browse, search and Google, and the number never shown. The number goes on hold, so new tuitions using it are refused. You can undo this with Unpause all.`,
      confirmLabel: 'Pause all their tuitions',
      destructive: false,
    })
    if (!yes) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; paused?: number }>('/api/admin/contact-withdraw/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: searched, reason }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data.error ?? 'That did not save.')
      return
    }
    toast.success(`Paused ${data.paused ?? 0} tuition(s). The number is on hold.`)
    setPhone(searched)
    await search()
    await refreshHolds()
  }

  async function unpauseAll(row: HoldRow) {
    const why = window.prompt(`Why unpause the tuitions using ${row.masked}?`)
    if (!why) return
    const { ok, data } = await adminFetch<{ error?: string; restored?: number }>('/api/admin/contact-withdraw/unpause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdId: row.id, reason: why }),
    })
    if (!ok) {
      toast.error(data.error ?? 'That did not save.')
      return
    }
    toast.success(`Unpaused: ${data.restored ?? 0} tuition(s) are back as they were, and the hold is lifted.`)
    await refreshHolds()
    if (searched) await search()
  }

  async function withdraw() {
    if (!result) return
    const closing = result.tuitions.filter((t) => t.willClose && !t.alreadyWithdrawn).length
    const yes = await confirm({
      title: `Remove ${result.masked} permanently?`,
      body: `${closing} tuition${closing === 1 ? '' : 's'} will be closed, the number removed from them, and the number added to the Do not use list. This cannot be undone from here.`,
      confirmLabel: 'Remove number permanently',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; closed?: number; contactsCleared?: number; leadsCleared?: number }>('/api/admin/contact-withdraw/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: searched, reason }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data.error ?? 'That did not save.')
      return
    }
    toast.success(`Contact withdrawn: ${data.closed ?? 0} tuition(s) closed, the number removed and added to the Do not use list.`)
    setPhone(searched)
    await search()
    await refreshList()
  }

  async function removeEntry(row: ListRow) {
    const why = window.prompt(`Why remove ${row.masked} from the Do not use list?`)
    if (!why) return
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/contact-withdraw/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, reason: why }),
    })
    if (!ok) {
      toast.error(data.error ?? 'That did not save.')
      return
    }
    toast.success('Removed from the Do not use list.')
    await refreshList()
  }

  const closing = result?.tuitions.filter((t) => t.willClose && !t.alreadyWithdrawn) ?? []
  const pausing = closing.filter((t) => !t.pausedOnComplaint)
  const parents = result?.accounts.filter((a) => a.isParent) ?? []
  const nothing = result && result.tuitions.length === 0 && result.accounts.length === 0 && result.leads.length === 0

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="wc-phone">Phone number</label>
          <input
            id="wc-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0300 1234567, +92 300 1234567 or 923001234567"
            className="min-h-11 flex-1 rounded-xl border border-gray-300 px-3 text-sm"
          />
          <button type="submit" disabled={busy || phone.trim().length < 10} className="min-h-11 rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-200 disabled:text-slate-700">
            {busy ? 'Searching…' : 'Find this number'}
          </button>
        </form>
      </section>

      {result && (
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-lg font-extrabold text-tm-navy">
            Results for {result.masked}
            {result.listed && <span className="ml-2 rounded-full bg-tm-tint-red px-2 py-0.5 text-xs font-bold text-tm-red">On the Do not use list</span>}
            {result.hold && <span className="ml-2 rounded-full bg-tm-tint-gold px-2 py-0.5 text-xs font-bold text-tm-gold-ink">On hold</span>}
          </h2>
          {result.pastWithdrawals > 0 && <p className="text-sm text-gray-600">Withdrawn {result.pastWithdrawals} time(s) before.</p>}
          {nothing && <p className="text-sm text-gray-600">This number is not stored anywhere on TutorMint.</p>}

          {parents.length > 0 && (
            <div className="rounded-xl border border-tm-gold/40 bg-tm-tint-gold p-3 text-sm text-tm-gold-ink">
              <p className="font-bold">This number belongs to a parent account.</p>
              <p className="mt-1">Withdrawing does not change accounts or their own tuitions. If this person wants their account gone, use Close account and erase data:</p>
              <ul className="mt-2 space-y-1">
                {parents.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/users/${a.id}#erase`} className="font-bold underline">Close account and erase data — {a.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.tuitions.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-800">Tuitions ({result.tuitions.length})</h3>
              <ul className="mt-2 divide-y divide-gray-100">
                {result.tuitions.map((t) => (
                  <li key={t.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/admin/jobs/${t.id}`} className="font-bold text-tm-navy hover:underline">
                        {t.ref ?? 'TM-?'} · {t.title}
                      </Link>
                      <p className="text-gray-600">
                        {t.city ?? 'No city'} · {t.statusLabel} · {t.postedBy}
                      </p>
                      <p className="text-gray-600">
                        Found in: {t.via.map((v) => VIA_WORDS[v]).join(', ')} · {t.applied} applied · {t.revealed} opened the number
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${t.alreadyWithdrawn || t.pausedOnComplaint ? 'bg-slate-100 text-slate-700' : t.willClose ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'}`}>
                      {t.alreadyWithdrawn ? 'Already withdrawn' : t.pausedOnComplaint ? 'Already paused' : t.willClose ? 'Uses this number' : 'Account tuition — use erase'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.accounts.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-800">Accounts ({result.accounts.length})</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {result.accounts.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/users/${a.id}`} className="font-bold text-tm-navy hover:underline">{a.name}</Link>{' '}
                    <span className="text-gray-600">({a.role}) · {a.fields.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.leads.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-800">Other records</h3>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {result.leads.map((l) => (
                  <li key={`${l.table}.${l.column}`}>{LEAD_WORDS[l.table] ?? l.table} ({l.column}): {l.rows}</li>
                ))}
              </ul>
            </div>
          )}

          {!nothing && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <label htmlFor="wc-reason" className="block text-sm font-bold text-slate-800">Reason (required)</label>
              <textarea id="wc-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={600} className="w-full rounded-xl border border-gray-300 p-3 text-sm" />
              <p className="text-xs text-gray-600">
                <strong>Pause all their tuitions</strong> (the default, reversible): pauses {pausing.length} tuition{pausing.length === 1 ? '' : 's'} and puts the
                number on hold. <strong>Remove number permanently</strong>: closes {closing.length}, removes the number from them and from other records, and
                adds it to the Do not use list. Tutors who applied see “This tuition is no longer available”, with no reason. You will be asked for your password.
              </p>
              <div className="flex flex-wrap gap-2" data-withdraw-actions="">
                <button
                  type="button"
                  onClick={pauseAll}
                  disabled={busy || reason.trim().length < 3 || !!result.hold}
                  className="min-h-11 rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:bg-gray-200 disabled:text-slate-700"
                >
                  Pause all their tuitions
                </button>
                <button
                  type="button"
                  onClick={withdraw}
                  disabled={busy || reason.trim().length < 3}
                  className="min-h-11 rounded-xl border border-tm-red px-4 text-sm font-bold text-tm-red hover:bg-tm-tint-red disabled:border-gray-200 disabled:bg-gray-200 disabled:text-slate-700"
                >
                  Remove number permanently
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-on-hold="">
        <h2 className="text-lg font-extrabold text-tm-navy">On hold ({holds.length})</h2>
        <p className="mt-1 text-sm text-gray-600">Numbers with a complaint on file. Their tuitions are paused and new tuitions using them are refused.</p>
        {holds.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">No numbers on hold.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {holds.map((h) => (
              <li key={h.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-800">{h.masked}</p>
                  <p className="text-gray-600">
                    {h.tuitions} tuition{h.tuitions === 1 ? '' : 's'} paused · {h.reason} · by {h.heldByName ?? 'Owner'}, {fmtDate(h.heldAt)}
                  </p>
                </div>
                <button type="button" onClick={() => unpauseAll(h)} className="min-h-11 shrink-0 rounded-xl border border-gray-300 px-3 text-sm font-bold text-slate-700 hover:border-tm-navy hover:text-tm-navy">
                  Unpause all
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-extrabold text-tm-navy">Do not use list ({list.length})</h2>
        <p className="mt-1 text-sm text-gray-600">Posting a tuition, bulk import and admin edits refuse these numbers. Stored only as a hash.</p>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">No numbers on the list.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {list.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-800">{r.masked}</p>
                  <p className="text-gray-600">{r.reason} · added by {r.addedByName ?? 'Owner'}, {fmtDate(r.addedAt)}</p>
                </div>
                <button type="button" onClick={() => removeEntry(r)} className="min-h-11 shrink-0 rounded-xl border border-gray-300 px-3 text-sm font-bold text-slate-700 hover:border-tm-red hover:text-tm-red">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {CONSENT_UI_ENABLED && (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-extrabold text-tm-navy">Staff-posted tuitions with a parent number and no parent account</h2>
        <p className="mt-1 text-sm text-gray-600">All time, counts only — to check consent.</p>
        {report.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">None.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-1 font-bold">Staff</th>
                <th className="py-1 text-right font-bold">Tuitions</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.staff} className="border-t border-gray-100">
                  <td className="py-1.5 text-slate-800">{r.staff}</td>
                  <td className="py-1.5 text-right font-bold text-slate-800">{r.count}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200">
                <td className="py-1.5 font-bold text-slate-800">Total</td>
                <td className="py-1.5 text-right font-bold text-slate-800">{report.reduce((s, r) => s + r.count, 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
      )}
    </div>
  )
}
