'use client'

import { useState } from 'react'

// Team activity → Paid sign-ups: paid sign-ups adding up day by day through the
// month against the straight target line (owner, 16 Oct 2026). One y-axis
// (paid sign-ups), thin 2px lines, the target dashed, a legend always present
// and the latest value labelled at each line's end. Hovering (or tapping) a day
// shows that day's numbers. "Show each person" adds one line per staff member,
// in a fixed colour order that follows the person, never their rank.
// Counts only.

type Line = { staffId: string; name: string; values: (number | null)[]; target: number[] | null }

// Fixed order — colour follows the entity (the order the server sends).
const PERSON_STROKES = ['stroke-tm-red', 'stroke-tm-green-deep', 'stroke-tm-gold-ink', 'stroke-slate-500', 'stroke-tm-navy-hover', 'stroke-gray-600']
const PERSON_DOTS = ['bg-tm-red', 'bg-tm-green-deep', 'bg-tm-gold-ink', 'bg-slate-500', 'bg-tm-navy-hover', 'bg-gray-600']

const W = 640
const H = 240
const PAD = { l: 32, r: 44, t: 12, b: 26 }

export default function CumulativeChart({
  days,
  team,
  teamTarget,
  people,
  monthLabel,
}: {
  days: number
  team: (number | null)[] | null
  teamTarget: number[] | null
  people: Line[]
  monthLabel: string
}) {
  // With no team line (a staff member sees only their own), the person IS the chart.
  const solo = !team
  const [showPeople, setShowPeople] = useState(solo)
  const [hover, setHover] = useState<number | null>(null)

  const main = team ?? people[0]?.values ?? []
  const mainTarget = team ? teamTarget : (people[0]?.target ?? null)
  const visiblePeople = solo ? [] : showPeople ? people : []
  const all: number[] = [
    ...main.filter((v): v is number => v != null),
    ...(mainTarget ?? []),
    ...visiblePeople.flatMap((p) => p.values.filter((v): v is number => v != null)),
  ]
  const maxV = Math.max(4, ...all)
  const yMax = Math.ceil(maxV / 4) * 4
  const x = (d: number) => PAD.l + (days <= 1 ? 0 : (d * (W - PAD.l - PAD.r)) / (days - 1))
  const y = (v: number) => H - PAD.b - (v * (H - PAD.t - PAD.b)) / yMax
  const path = (vals: (number | null)[]) =>
    vals
      .map((v, d) => (v == null ? null : `${x(d).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')
  const lastIdx = (vals: (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i
    return -1
  }
  const ticks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax]
  const mainName = solo ? (people[0]?.name ?? 'You') : 'Team'
  const mi = lastIdx(main)

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-tm-navy">Paid sign-ups through {monthLabel}</h3>
        {!solo && people.length > 0 && (
          <label className="flex min-h-[44px] items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={showPeople} onChange={(e) => setShowPeople(e.target.checked)} className="h-4 w-4" />
            Show each person
          </label>
        )}
      </div>

      {/* Legend: always present (two or more lines). */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-700">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-tm-navy" aria-hidden /> {mainName} (running total)
        </li>
        {mainTarget && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-gray-400" aria-hidden /> Target line
          </li>
        )}
        {visiblePeople.map((p, i) => (
          <li key={p.staffId} className="flex items-center gap-1.5">
            <span className={`inline-block h-0.5 w-4 ${PERSON_DOTS[i % PERSON_DOTS.length]}`} aria-hidden /> {p.name}
          </li>
        ))}
      </ul>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${mainName} paid sign-ups by day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-gray-100" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-gray-500 text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {[1, Math.ceil(days / 2), days].map((d) => (
            <text key={d} x={x(d - 1)} y={H - 8} textAnchor="middle" className="fill-gray-500 text-[10px]">
              {d}
            </text>
          ))}
          {mainTarget && (
            <polyline points={path(mainTarget)} fill="none" className="stroke-gray-400" strokeWidth={2} strokeDasharray="5 4" />
          )}
          {visiblePeople.map((p, i) => (
            <polyline
              key={p.staffId}
              points={path(p.values)}
              fill="none"
              className={PERSON_STROKES[i % PERSON_STROKES.length]}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ))}
          <polyline points={path(main)} fill="none" className="stroke-tm-navy" strokeWidth={2} strokeLinejoin="round" />
          {mi >= 0 && (
            <>
              <circle cx={x(mi)} cy={y(main[mi]!)} r={4} className="fill-tm-navy stroke-white" strokeWidth={2} />
              <text x={x(mi) + 7} y={y(main[mi]!) + 4} className="fill-slate-800 text-[11px] font-bold">
                {main[mi]}
              </text>
            </>
          )}
          {mainTarget && (
            <text x={x(days - 1) + 5} y={y(mainTarget[days - 1]) + 4} className="fill-gray-500 text-[10px]">
              {mainTarget[days - 1]}
            </text>
          )}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="stroke-gray-300" strokeWidth={1} />
          )}
          {Array.from({ length: days }, (_, d) => (
            <rect
              key={d}
              x={x(d) - (W - PAD.l - PAD.r) / Math.max(1, days - 1) / 2}
              y={PAD.t}
              width={(W - PAD.l - PAD.r) / Math.max(1, days - 1)}
              height={H - PAD.t - PAD.b}
              fill="transparent"
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover((h) => (h === d ? null : d))}
            />
          ))}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] text-slate-800 shadow">
            <p className="font-bold text-tm-navy">Day {hover + 1}</p>
            <p>
              {mainName}: {main[hover] ?? '—'}
              {mainTarget ? ` · target ${mainTarget[hover]}` : ''}
            </p>
            {visiblePeople.map((p) => (
              <p key={p.staffId}>
                {p.name}: {p.values[hover] ?? '—'}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
