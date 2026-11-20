// Admin → Insights: active tutors, parents and signed-out visitors per day
// (PR-12). A small server-drawn line chart — one y-axis, thin lines, a legend
// always shown, each line's latest value at its end. Counts only.

type Day = { day: string; tutors: number; parents: number; visitors: number }

const W = 640
const H = 200
const PAD = { l: 32, r: 40, t: 10, b: 24 }

const LINES = [
  { key: 'visitors' as const, label: 'Visitors (signed out)', stroke: 'stroke-slate-500', dot: 'bg-slate-500', fill: 'fill-slate-700' },
  { key: 'tutors' as const, label: 'Tutors', stroke: 'stroke-tm-navy', dot: 'bg-tm-navy', fill: 'fill-tm-navy' },
  { key: 'parents' as const, label: 'Parents', stroke: 'stroke-tm-green-deep', dot: 'bg-tm-green-deep', fill: 'fill-tm-green-deep' },
]

export default function ActiveChart({ daily }: { daily: Day[] }) {
  const n = daily.length
  const maxV = Math.max(4, ...daily.flatMap((d) => [d.tutors, d.parents, d.visitors]))
  const yMax = Math.ceil(maxV / 4) * 4
  const x = (i: number) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1))
  const y = (v: number) => H - PAD.b - (v * (H - PAD.t - PAD.b)) / yMax
  const ticks = [0, yMax / 2, yMax]
  const labelEvery = Math.max(1, Math.ceil(n / 7))
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-700">
        {LINES.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2 w-3 rounded-sm ${l.dot}`} />
            {l.label}
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Active tutors, parents and visitors per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-gray-200" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-700 text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {daily.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-700 text-[10px]">
              {d.day.slice(5)}
            </text>
          ) : null,
        )}
        {LINES.map((l) => {
          const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d[l.key]).toFixed(1)}`).join(' ')
          const last = daily[n - 1]
          return (
            <g key={l.key}>
              {n > 1 ? <polyline points={pts} fill="none" className={l.stroke} strokeWidth={2} /> : null}
              {last ? <circle cx={x(n - 1)} cy={y(last[l.key])} r={3} className={l.fill} /> : null}
              {last ? (
                <text x={x(n - 1) + 6} y={y(last[l.key]) + 3} className={`${l.fill} text-[10px] font-bold`}>
                  {last[l.key]}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
