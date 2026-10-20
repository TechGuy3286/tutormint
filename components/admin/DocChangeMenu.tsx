'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'

import { CHANGE_OPTION_LABEL, type ChangeOption } from '@/lib/docChangeMenuCore'

// The "Change ▾" menu on a decided document (owner, 20 Oct 2026): Approve,
// Reject (which opens the quick reasons) and Unlock for re-upload, in one
// place. Which options appear is decided by lib/docChangeMenuCore — the Owner
// only; the server rules are unchanged.

export default function DocChangeMenu({
  options,
  onPick,
  busy = false,
}: {
  options: ChangeOption[]
  onPick: (o: ChangeOption) => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (options.length === 0) return null
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50"
      >
        {busy ? <Loader2 aria-hidden size={12} className="animate-spin" /> : null}
        Change
        <ChevronDown aria-hidden size={12} />
      </button>
      {open && (
        <ul role="menu" className="absolute left-0 z-20 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <li key={o} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onPick(o)
                }}
                className={`flex min-h-[40px] w-full items-center px-3 text-left text-xs font-bold hover:bg-tm-bg ${
                  o === 'reject' ? 'text-tm-red' : o === 'approve' ? 'text-tm-green-deep' : 'text-tm-navy'
                }`}
              >
                {CHANGE_OPTION_LABEL[o]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
