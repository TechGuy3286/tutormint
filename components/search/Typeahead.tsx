'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Clock, TrendingUp } from 'lucide-react'
import { readRecent, pushRecent } from '@/lib/recentSearches'
import type { Suggestion, SuggestGroup } from '@/app/api/search/suggest/route'

// The one search input on the platform. There is no search button anywhere
// after T-Search, so this component IS the search: it fetches on a debounce,
// renders grouped suggestions, and drives the results list underneath it.
//
// Two things it does at once, and they are deliberately separate:
//
//   onQueryChange  fires on every debounced change, and the page it lives on
//                  re-renders its results from the URL. This is the "results
//                  refresh live" half.
//   onCommit       fires only when the member means it — Enter, a click on a
//                  suggestion, or "Show all results". This is what gets
//                  recorded as a search and remembered on the device.
//
// Collapsing those two into one would either log a timeline entry per
// keystroke or stop the list updating as you type. Both were tried in the
// spec's own wording; keeping them apart is what satisfies it.

type Props = {
  /** Initial text, from the URL on the server render. */
  initialQuery?: string
  placeholder: string
  ariaLabel: string
  /** Debounced, on every change. The page writes the URL and re-renders. */
  onQueryChange: (q: string) => void
  /** Enter, suggestion click, or "Show all". Receives the committed text. */
  onCommit?: (q: string) => void
  /**
   * Suggestion panel. Off for admin screens, whose datasets are not the public
   * search index — there the input is still a typeahead (live results, no
   * button), just without a panel of public suggestions over the top.
   */
  suggest?: boolean
  /** Scopes tutor hits and popular subjects. */
  city?: string
  /** Groups to render, in order. Only groups with hits are shown. */
  groups?: SuggestGroup[]
}

const GROUP_LABEL: Record<SuggestGroup, string> = {
  subject: 'Subjects & levels',
  location: 'Cities & areas',
  tutor: 'Tutors',
  job: 'Tuition jobs',
}

const DEFAULT_GROUPS: SuggestGroup[] = ['subject', 'location', 'tutor', 'job']

/** One navigable row. The panel groups these visually; the keyboard sees a
    single flat list. */
type Row = { kind: 'suggestion' | 'recent' | 'showall'; value: string; item?: Suggestion }

const DEBOUNCE_MS = 250
const MIN_CHARS = 2

export default function Typeahead({
  initialQuery = '',
  placeholder,
  ariaLabel,
  onQueryChange,
  onCommit,
  suggest = true,
  city,
  groups = DEFAULT_GROUPS,
}: Props) {
  const router = useRouter()
  const listId = useId()

  const [q, setQ] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [popular, setPopular] = useState<Suggestion[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Recent searches are read once, on mount. Reading during render would
  // differ between the server pass and the client pass and hydrate wrong.
  useEffect(() => {
    setRecent(readRecent())
  }, [])

  // ---------------------------------------------------------------- fetch --
  const fetchSuggestions = useCallback(
    async (text: string) => {
      // Cancel whatever is still in the air. Without this the answer to "phy"
      // can land after the answer to "physics" and overwrite it — the panel
      // would show results for a prefix the member has already moved past.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const params = new URLSearchParams({ q: text })
        if (city) params.set('city', city)
        const res = await fetch(`/api/search/suggest?${params}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          setSuggestions([])
          setPopular([])
          return
        }
        const data = (await res.json()) as { suggestions: Suggestion[]; popular: Suggestion[] }
        setSuggestions(data.suggestions ?? [])
        setPopular(data.popular ?? [])
      } catch {
        // An aborted request is the normal case here, not a failure.
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [city],
  )

  // ----------------------------------------------------------- typing ------
  const handleChange = (text: string) => {
    setQ(text)
    setActive(-1)
    setOpen(true)

    if (queryTimer.current) clearTimeout(queryTimer.current)
    if (fetchTimer.current) clearTimeout(fetchTimer.current)

    queryTimer.current = setTimeout(() => onQueryChange(text), DEBOUNCE_MS)

    if (!suggest) return
    fetchTimer.current = setTimeout(() => {
      void fetchSuggestions(text.trim())
    }, DEBOUNCE_MS)
  }

  useEffect(
    () => () => {
      if (queryTimer.current) clearTimeout(queryTimer.current)
      if (fetchTimer.current) clearTimeout(fetchTimer.current)
      abortRef.current?.abort()
    },
    [],
  )

  // Close on an outside click. Blur alone is not enough: a click that lands on
  // a suggestion blurs the input before the click resolves.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // ------------------------------------------------------------- rows ------
  // One flat list drives keyboard navigation; the visual grouping is a
  // rendering detail laid over the same array, so ArrowDown never has to know
  // which heading it is passing.
  const grouped = useMemo(() => {
    const showEmptyState = q.trim().length < MIN_CHARS
    if (showEmptyState) return []
    return groups
      .map((g) => ({ group: g, items: suggestions.filter((s) => s.group === g) }))
      .filter((g) => g.items.length > 0)
  }, [groups, suggestions, q])

  const emptyState = q.trim().length < MIN_CHARS
  const showAllRow = !emptyState && q.trim().length >= MIN_CHARS

  const flatRows: Row[] = useMemo(() => {
    if (emptyState) {
      return [
        ...recent.map((r) => ({ kind: 'recent' as const, value: r })),
        ...popular.map((p) => ({ kind: 'suggestion' as const, value: p.href, item: p })),
      ]
    }
    const rows: Row[] = grouped.flatMap((g) =>
      g.items.map((item) => ({ kind: 'suggestion' as const, value: item.href, item })),
    )
    if (showAllRow) rows.push({ kind: 'showall', value: q.trim() })
    return rows
  }, [emptyState, recent, popular, grouped, showAllRow, q])

  // ---------------------------------------------------------- committing --
  const commit = useCallback(
    (text: string) => {
      const t = text.trim()
      if (t.length >= MIN_CHARS) pushRecent(t)
      setRecent(readRecent())
      setOpen(false)
      setActive(-1)
      if (queryTimer.current) clearTimeout(queryTimer.current)
      onQueryChange(t)
      onCommit?.(t)
    },
    [onQueryChange, onCommit],
  )

  const choose = useCallback(
    (row: (typeof flatRows)[number]) => {
      if (row.kind === 'showall') return commit(row.value)
      if (row.kind === 'recent') {
        setQ(row.value)
        return commit(row.value)
      }
      // A suggestion is a destination, not a query: it already knows the exact
      // master_id or slug, so following it is more precise than searching for
      // its label would be.
      if (row.item) {
        pushRecent(row.item.label)
        setOpen(false)
        router.push(row.item.href)
      }
    },
    [commit, router],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && flatRows[active]) choose(flatRows[active])
      else commit(q)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) {
        setOpen(true)
        return
      }
      if (flatRows.length === 0) return
      e.preventDefault()
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        if (next < 0) return flatRows.length - 1
        if (next >= flatRows.length) return 0
        return next
      })
    }
  }

  const panelOpen = open && suggest && (flatRows.length > 0 || loading)

  // Index into flatRows while rendering the grouped view.
  let cursor = emptyState ? recent.length : 0

  return (
    <div ref={boxRef} className="relative flex-1">
      <Search
        size={16}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
        value={q}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setOpen(true)
          if (suggest && q.trim().length < MIN_CHARS && popular.length === 0) {
            void fetchSuggestions('')
          }
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            setQ('')
            setActive(-1)
            commit('')
            inputRef.current?.focus()
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:text-tm-navy"
        >
          <X size={14} />
        </button>
      )}

      {/* Absolutely positioned so opening it never moves the results below --
          "no layout shift" in the spec means exactly this. Full width on
          mobile because it is already the full width of the field. */}
      {panelOpen && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {emptyState ? (
            <>
              {recent.length > 0 && (
                <Section title="Recent searches" icon={<Clock size={12} aria-hidden />}>
                  {recent.map((r, i) => (
                    <OptionRow
                      key={`recent-${r}`}
                      id={`${listId}-${i}`}
                      active={active === i}
                      onSelect={() => choose({ kind: 'recent', value: r })}
                      onHover={() => setActive(i)}
                      label={r}
                    />
                  ))}
                </Section>
              )}
              {popular.length > 0 && (
                <Section title="Popular subjects" icon={<TrendingUp size={12} aria-hidden />}>
                  {popular.map((p, i) => {
                    const idx = recent.length + i
                    return (
                      <OptionRow
                        key={`pop-${p.ref}`}
                        id={`${listId}-${idx}`}
                        active={active === idx}
                        onSelect={() => choose({ kind: 'suggestion', value: p.href, item: p })}
                        onHover={() => setActive(idx)}
                        label={p.label}
                        sublabel={p.sublabel}
                      />
                    )
                  })}
                </Section>
              )}
              {recent.length === 0 && popular.length === 0 && !loading && (
                <p className="px-3 py-3 text-[11px] text-gray-500">
                  Type at least {MIN_CHARS} characters to search.
                </p>
              )}
            </>
          ) : (
            <>
              {grouped.map((g) => (
                <Section key={g.group} title={GROUP_LABEL[g.group]}>
                  {g.items.map((item) => {
                    const idx = cursor++
                    return (
                      <OptionRow
                        key={`${g.group}-${item.ref}`}
                        id={`${listId}-${idx}`}
                        active={active === idx}
                        onSelect={() => choose({ kind: 'suggestion', value: item.href, item })}
                        onHover={() => setActive(idx)}
                        label={item.label}
                        sublabel={item.sublabel}
                      />
                    )
                  })}
                </Section>
              ))}
              {grouped.length === 0 && !loading && (
                <p className="px-3 py-3 text-[11px] text-gray-500">
                  Nothing matched. Try a subject, a city, or a tutor&apos;s name.
                </p>
              )}
              {showAllRow && (
                <OptionRow
                  id={`${listId}-${flatRows.length - 1}`}
                  active={active === flatRows.length - 1}
                  onSelect={() => commit(q)}
                  onHover={() => setActive(flatRows.length - 1)}
                  label={`Show all results for "${q.trim()}"`}
                  emphasis
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-gray-100 py-1 last:border-b-0">
      <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
        {icon}
        {title}
      </p>
      {children}
    </div>
  )
}

/** 44px minimum height: the spec's mobile tap-target rule, applied everywhere. */
function OptionRow({
  id,
  active,
  onSelect,
  onHover,
  label,
  sublabel,
  emphasis,
}: {
  id: string
  active: boolean
  onSelect: () => void
  onHover: () => void
  label: string
  sublabel?: string
  emphasis?: boolean
}) {
  return (
    <button
      id={id}
      role="option"
      aria-selected={active}
      type="button"
      // onMouseDown, not onClick: the input blurs first on a click and the
      // panel would unmount before the click landed.
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect()
      }}
      onMouseEnter={onHover}
      className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left ${
        active ? 'bg-tm-tint-navy' : 'bg-white'
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block truncate text-xs ${
            emphasis ? 'font-bold text-tm-red' : 'font-semibold text-tm-navy'
          }`}
        >
          {label}
        </span>
        {sublabel && <span className="block truncate text-[11px] text-gray-500">{sublabel}</span>}
      </span>
    </button>
  )
}
