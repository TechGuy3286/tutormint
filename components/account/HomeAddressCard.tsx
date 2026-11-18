'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, PenLine } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { ADDRESS_FROM_CNIC_NOTE } from '@/lib/cnicAddressCore'

// Home address (owner, 18 Nov 2026 — PR-07). When we read an address from the
// member's CNIC back and they have none of their own, it is shown pre-filled
// with "We read this from your CNIC. Is this your current address?" and
// Confirm / Edit. Only Confirm or Edit saves it (/api/profile/address-suggestion).
//
//   mode 'suggestion' — parents' Settings, which has its own address box: this
//                       shows only while a suggestion waits, and hands the
//                       saved address back (onSaved) so that box shows it.
//   mode 'full'       — tutors' Edit Profile: the suggestion, or the member's
//                       own address with Edit.
// Only the member and our verification team see the address. New text is
// English only.

type State = { address: string | null; suggestion: { address: string; city: string } | null }

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold disabled:opacity-60'

export default function HomeAddressCard({ mode = 'full', onSaved }: { mode?: 'full' | 'suggestion'; onSaved?: (address: string) => void }) {
  const toast = useToast()
  const [state, setState] = useState<State | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const r = await fetch('/api/profile/address-suggestion', { cache: 'no-store' })
        const j = (await r.json().catch(() => ({}))) as Partial<State>
        if (live) setState(r.ok ? { address: j.address ?? null, suggestion: j.suggestion ?? null } : { address: null, suggestion: null })
      } catch {
        if (live) setState({ address: null, suggestion: null })
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const save = async (action: 'confirm' | 'edit') => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/profile/address-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'confirm' ? { action } : { action, address: text }),
      })
      const j = (await r.json().catch(() => ({}))) as { address?: string; error?: string }
      if (!r.ok) {
        toast.error(j.error ?? 'That did not save. Please try again.')
        return
      }
      const saved = j.address ?? ''
      setState({ address: saved, suggestion: null })
      setEditing(false)
      onSaved?.(saved)
      toast.success(action === 'confirm' ? 'Thank you. Your address is confirmed.' : 'Your address is saved.')
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!state) return mode === 'full' ? <p className="text-xs text-gray-500">Loading…</p> : null
  const s = state.suggestion
  if (mode === 'suggestion' && !s) return null

  const editor = (
    <div className="space-y-2">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Home address"
        className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium text-slate-700"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save('edit')} disabled={busy} className={`${BTN} bg-tm-navy text-white`}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Save
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className={`${BTN} border border-gray-200 bg-white text-slate-700`}>
          Cancel
        </button>
      </div>
    </div>
  )

  if (s) {
    return (
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3" data-address-suggestion="">
        <p className="text-sm font-bold text-tm-navy">Home address</p>
        <p className="text-xs font-semibold text-slate-700">{ADDRESS_FROM_CNIC_NOTE}</p>
        {editing ? (
          editor
        ) : (
          <>
            <p className="whitespace-pre-line rounded-xl border border-gray-100 bg-tm-bg p-3 text-xs text-slate-700">{s.address}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save('confirm')} disabled={busy} className={`${BTN} bg-tm-green-deep text-white`}>
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <CheckCircle2 size={14} aria-hidden />} Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setText(s.address)
                  setEditing(true)
                }}
                disabled={busy}
                className={`${BTN} border border-gray-200 bg-white text-tm-navy`}
              >
                <PenLine size={14} aria-hidden /> Edit
              </button>
            </div>
          </>
        )}
        <p className="text-[11px] text-gray-500">Only you and our verification team see this. It is never on a public page.</p>
      </div>
    )
  }

  // Tutors' own address (mode 'full').
  return (
    <div className="space-y-2" data-home-address="">
      {editing ? (
        editor
      ) : (
        <>
          <p className="whitespace-pre-line rounded-xl border border-gray-100 bg-tm-bg p-3 text-xs text-slate-700">
            {state.address?.trim() ? state.address : 'No address added yet. Add it so our team can verify you faster.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setText(state.address ?? '')
              setEditing(true)
            }}
            className={`${BTN} border border-gray-200 bg-white text-tm-navy`}
          >
            <PenLine size={14} aria-hidden /> {state.address?.trim() ? 'Edit' : 'Add address'}
          </button>
        </>
      )}
      <p className="text-[11px] text-gray-500">Only you and our verification team see this. It is never on a public page.</p>
    </div>
  )
}
