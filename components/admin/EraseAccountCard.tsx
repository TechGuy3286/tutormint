'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// "Close account and erase data" (owner, 27 Oct 2026) — the site Owner only;
// the page renders this card only for the Owner and the route refuses everyone
// else. A reason, how the person's identity was confirmed, and the password
// (asked again by adminFetch when the server wants it). "Erase in 7 days" is
// the default and can be cancelled until then; "Erase now" is for requests
// already confirmed. Afterwards: a confirmation message to copy and send.

type State = {
  erasure: { status: 'scheduled' | 'cancelled' | 'done' | 'failed'; source: 'owner' | 'member'; dueAt: string; doneAt: string | null; countdown: string | null } | null
  confirmation: string
}

const ID_EXAMPLES = ['Email matches account', 'Confirmed on WhatsApp from the account’s number']

export default function EraseAccountCard({ memberId }: { memberId: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [state, setState] = useState<State | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [identity, setIdentity] = useState('')
  const [mode, setMode] = useState<'later' | 'now'>('later')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    const { ok, data } = await adminFetch<State & { error?: string }>(`/api/admin/members/erase?memberId=${memberId}`)
    if (ok && data) setState(data)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; ran?: boolean; emailed?: boolean; dueAt?: string }>('/api/admin/members/erase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...body }),
    })
    setBusy(false)
    return { ok, data }
  }

  const submit = async () => {
    const sure = await confirm({
      title: mode === 'now' ? 'Erase this account now?' : 'Erase this account in 7 days?',
      body:
        mode === 'now'
          ? 'Their name, contact details, CNIC, documents, photo and message contents are deleted now. This cannot be undone. Payments and history stay, with no personal details.'
          : 'Their personal data will be deleted in 7 days. You can cancel until then.',
      confirmLabel: mode === 'now' ? 'Erase now' : 'Erase in 7 days',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!sure) return
    const { ok, data } = await post({ action: 'schedule', reason, identityCheck: identity, mode })
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(data?.ran ? `Account erased.${data.emailed ? ' The confirmation was emailed to them.' : ''}` : 'Erase scheduled for 7 days from now.')
    setOpen(false)
    await load()
    router.refresh()
  }

  const cancel = async () => {
    const sure = await confirm({ title: 'Cancel the erase?', body: 'Nothing will be deleted.', confirmLabel: 'Cancel the erase', cancelLabel: 'Keep it scheduled', destructive: false })
    if (!sure) return
    const { ok, data } = await post({ action: 'cancel' })
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success('Erase cancelled. Nothing was deleted.')
    await load()
    router.refresh()
  }

  const e = state?.erasure ?? null
  const canSubmit = reason.trim().length >= 3 && identity.trim().length >= 3 && !busy

  return (
    <section className="rounded-2xl border border-tm-red/30 bg-white p-4 sm:p-5" aria-labelledby="erase-heading">
      <h2 id="erase-heading" className="flex items-center gap-2 text-sm font-extrabold text-tm-red">
        <Trash2 aria-hidden size={16} /> Close account and erase data
      </h2>

      {e?.status === 'done' ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-700">
            This account was closed and its personal data erased
            {e.doneAt ? ` on ${new Date(e.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}` : ''}.
          </p>
          <ConfirmationCopy text={state!.confirmation} copied={copied} onCopy={() => setCopied(true)} />
        </div>
      ) : e?.status === 'scheduled' ? (
        <div className="mt-3 space-y-3">
          <p className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red-hover">
            {e.countdown} — on {new Date(e.dueAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })}
            {e.source === 'member' ? ' (asked for by the member in Settings)' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void cancel()} disabled={busy} className="min-h-[44px] rounded-xl border border-gray-300 bg-white px-4 text-xs font-extrabold text-slate-800 hover:bg-tm-bg disabled:opacity-60">
              Cancel the erase
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('now')
                setOpen(true)
              }}
              disabled={busy}
              className="min-h-[44px] rounded-xl border border-tm-red/40 bg-white px-4 text-xs font-extrabold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
            >
              Erase now instead
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-700">
            Only when the member asks. Their name, phone numbers, emails, CNIC, address, profile text, areas, documents, photo, selfie, video and message contents are deleted. Payments and history stay, with no personal details.
          </p>
          {e?.status === 'failed' && <p className="mt-2 text-xs font-bold text-tm-red">The last erase did not finish. You can run it again.</p>}
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-[44px] rounded-xl border border-tm-red/40 bg-white px-4 text-xs font-extrabold text-tm-red hover:bg-tm-tint-red">
              Close account and erase data
            </button>
          )}
        </>
      )}

      {open && e?.status !== 'done' && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <label className="block">
            <span className="text-[11px] font-bold text-tm-navy">Reason</span>
            <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} rows={2} maxLength={600} placeholder="e.g. Asked by email to delete their account" className="mt-1 w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs" />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-tm-navy">How was identity confirmed?</span>
            <input value={identity} onChange={(ev) => setIdentity(ev.target.value)} maxLength={300} list="erase-id-examples" placeholder="e.g. Email matches account" className="mt-1 w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs" />
            <datalist id="erase-id-examples">
              {ID_EXAMPLES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          {e?.status !== 'scheduled' && (
            <fieldset className="space-y-2">
              <legend className="text-[11px] font-bold text-tm-navy">When</legend>
              <label className="flex items-center gap-2 text-xs text-slate-800">
                <input type="radio" name="erase-mode" checked={mode === 'later'} onChange={() => setMode('later')} /> Erase in 7 days (can be cancelled until then)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-800">
                <input type="radio" name="erase-mode" checked={mode === 'now'} onChange={() => setMode('now')} /> Erase now (request already confirmed)
              </label>
            </fieldset>
          )}
          <p className="text-[11px] text-gray-500">You will be asked for your password.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="min-h-[44px] rounded-xl bg-tm-red px-4 text-xs font-extrabold text-white hover:bg-tm-red-hover disabled:opacity-60">
              {busy ? 'Working…' : mode === 'now' ? 'Erase now' : 'Erase in 7 days'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-xl border border-gray-300 bg-white px-4 text-xs font-extrabold text-slate-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function ConfirmationCopy({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-tm-bg p-3">
      <p className="text-xs text-slate-800">{text}</p>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(text).then(onCopy).catch(() => {})}
        className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-xs font-extrabold text-tm-navy"
      >
        <Copy aria-hidden size={14} /> {copied ? 'Copied' : 'Copy confirmation'}
      </button>
    </div>
  )
}
