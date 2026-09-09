'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'

// A custom single-select: a button showing the current value, a list that opens
// beneath it, click to choose. It matches the field style of the "Where, how
// and when" selects (components/forms/WhereHowWhen) — same border, height, left
// icon and chevron — so a form built from both reads as one set of controls
// rather than two.
//
// Keyboard: the button opens on Enter / Space / ArrowDown; inside, ArrowUp /
// ArrowDown move the highlight, Enter chooses, Escape closes. A long list can be
// searchable — typing filters, and the arrow keys still drive the highlight.
// Announced as a combobox over a listbox for assistive tech.

export type SelectOption = { value: string; label: string }

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select',
  icon,
  searchable = false,
  disabled = false,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  /** A left-hand recognising icon, ~15px, to match the other fields. */
  icon?: ReactNode
  searchable?: boolean
  disabled?: boolean
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const filtered =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options
  const current = options.find((o) => o.value === value)

  // Close when a click lands outside the control.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // On open: clear the query, highlight the current value, focus the search box.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const idx = Math.max(0, options.findIndex((o) => o.value === value))
    setActive(idx)
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus())
    // options/value are stable for the lifetime of an open popover in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, listId])

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(filtered.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[active]
      if (o) choose(o.value)
    }
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-left text-xs font-semibold text-tm-navy outline-none focus:border-tm-red disabled:opacity-60"
      >
        {icon && <span className="shrink-0 text-gray-500">{icon}</span>}
        <span className={`flex-1 truncate ${current ? '' : 'text-gray-500'}`}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-gray-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              placeholder={`Search ${ariaLabel.toLowerCase()}…`}
              className="w-full border-b border-gray-100 px-3 py-2 text-xs text-slate-700 outline-none"
            />
          )}
          <ul role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[11px] text-gray-500">No matches.</li>
            ) : (
              filtered.map((o, i) => {
                const selected = o.value === value
                return (
                  <li
                    key={o.value}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={`flex min-h-[40px] cursor-pointer items-center gap-2 px-3 text-xs ${
                      i === active ? 'bg-tm-tint-navy' : ''
                    } ${selected ? 'font-bold text-tm-navy' : 'text-slate-700'}`}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {selected && <Check size={14} aria-hidden className="shrink-0 text-tm-navy" />}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
