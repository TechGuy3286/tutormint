'use client'

import { useId, useState } from 'react'
import { Table2 } from 'lucide-react'

// The frame every admin chart sits in.
//
// THREE THINGS IT GUARANTEES, so no individual chart has to remember them:
//
//   1. AN EMPTY QUERY SAYS SO. A chart with no rows draws an axis with nothing
//      on it, which reads as "broken" rather than "nothing happened yet" — and
//      on a platform whose first real tutors are still being onboarded, half
//      these queries legitimately return nothing. The empty branch is a
//      sentence, not a blank plot.
//
//   2. A TABLE VIEW EXISTS. Every value in a chart has to be reachable without
//      colour vision and without a pointer: the table is the WCAG-clean twin.
//      It is also what relieves the one contrast warning in the palette —
//      tm-gold is a fill and cannot be read as a hue at 2.09:1 against white,
//      so its numbers have to be legible somewhere that is not the chart.
//
//   3. TEXT WEARS TEXT TOKENS. Titles, values, legends and axis labels are ink
//      colours; only the marks carry a series colour. A legend swatch beside
//      the words is how identity is carried, never by colouring the words.

export type TableColumn = { key: string; label: string; numeric?: boolean }

export default function ChartCard({
  title,
  meaning,
  empty,
  legend,
  columns,
  rows,
  children,
}: {
  title: string
  meaning: string
  /** When set, the chart is not drawn and this sentence is shown instead. */
  empty?: string | null
  legend?: { label: string; color: string }[]
  columns: TableColumn[]
  rows: Record<string, string | number>[]
  children: React.ReactNode
}) {
  const [table, setTable] = useState(false)
  const tableId = useId()

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-tm-navy">{title}</h2>
          <p className="text-[11px] text-gray-500">{meaning}</p>
        </div>

        {!empty && (
          <button
            type="button"
            onClick={() => setTable((t) => !t)}
            aria-expanded={table}
            aria-controls={tableId}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            <Table2 aria-hidden size={13} />
            {table ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>

      {empty ? (
        <p className="mt-4 rounded-xl bg-tm-bg p-4 text-xs text-gray-500">{empty}</p>
      ) : table ? (
        <div id={tableId} className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`py-2 pr-3 text-[10px] font-black uppercase tracking-wide text-gray-500 ${
                      c.numeric ? 'text-right' : ''
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-200 last:border-0">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2 pr-3 text-slate-700 ${
                        c.numeric ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {legend && legend.length > 1 && (
            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {legend.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">{children}</div>
        </>
      )}
    </section>
  )
}
