'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NotebookPen } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { NOTE_KIND_LABEL, NOTE_KINDS, NOTE_MAX, noteProblem, withdrawProblem, type NoteKind } from '@/lib/journeyCore'

// The two writes on the Activity tab (owner, 23 Oct 2026): "Log a call or note"
// and "Withdraw" on a note. A note cannot be edited; withdrawing needs a reason
// and keeps the note on the timeline, struck through.

export function LogNoteButton({ memberId }: { memberId: string }) {
  const readOnly = useAdminReadOnly()
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<NoteKind>('call')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  if (readOnly) return null
  const problem = body.trim() ? noteProblem(body) : null

  const save = async () => {
    const p = noteProblem(body)
    if (p) return void toast.error(p)
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/members/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log', memberId, kind, body }),
    })
    setBusy(false)
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(`${NOTE_KIND_LABEL[kind]} logged.`)
    setBody('')
    setOpen(false)
    router.refresh()
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
      >
        <NotebookPen aria-hidden size={14} /> Log a call or note
      </button>
    )

  return (
    <div className="w-full space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-[11px] font-bold text-gray-600">Type</legend>
        {NOTE_KINDS.map((k) => (
          <label key={k} className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${kind === k ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 text-tm-navy'}`}>
            <input type="radio" name="note-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {NOTE_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold text-gray-600">What happened (short)</span>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={NOTE_MAX}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs"
          placeholder="e.g. Called, will upload the CNIC tonight"
        />
      </label>
      <p className="text-[11px] text-gray-500">Notes cannot be edited later, only withdrawn. Do not write phone numbers, CNIC numbers or emails.</p>
      {problem && <p className="text-xs font-bold text-tm-red">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !body.trim() || !!problem} onClick={() => void save()} className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function WithdrawNoteButton({ noteId }: { noteId: string }) {
  const readOnly = useAdminReadOnly()
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (readOnly) return null
  const save = async () => {
    const p = withdrawProblem(reason)
    if (p) return void toast.error(p)
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/members/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw', noteId, reason }),
    })
    setBusy(false)
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success('Note withdrawn. It stays on the timeline.')
    setOpen(false)
    router.refresh()
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-[32px] text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
        Withdraw
      </button>
    )
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="Why is it withdrawn?"
        aria-label="Reason for withdrawing the note"
        className="min-h-[36px] min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 text-xs"
      />
      <button type="button" disabled={busy || !reason.trim()} onClick={() => void save()} className="min-h-[36px] rounded-lg bg-tm-black px-3 text-xs font-bold text-white disabled:opacity-50">
        {busy ? 'Saving…' : 'Withdraw note'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-[36px] rounded-lg border border-gray-200 px-3 text-xs font-bold text-slate-700">
        Cancel
      </button>
    </span>
  )
}
