'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import ChartCard from '@/components/admin/charts/ChartCard'
import { CHART } from '@/lib/brand'
import { formatDate } from '@/lib/datetime'
import type { SignupPoint } from '@/lib/adminOverview'

// Signups by role, one column per day.
//
// COLUMNS, NOT A LINE. A line between Tuesday and Thursday says something
// happened on Wednesday. These are counts of discrete events on discrete days,
// and on a young platform most days are legitimately zero — a line would draw
// a slope through them and invent a trend.
//
// STACKED, NOT GROUPED. Thirty days side by side is sixty bars in ~700px; the
// stack keeps each day one mark and makes the day's total readable as height,
// which is the second question anyone asks after "how many tutors".
//
// NO NUMBER ON EVERY COLUMN. Thirty labels is chaos and goes unread — the axis
// carries the scale, the tooltip carries the day, and the table view carries
// every value exactly.
//
// The days are KARACHI days (lib/datetime pkDayKey), because "the same day"
// has to mean the same thing to a reader in Lahore as it does to the row.

const TICK = { fontSize: 10, fill: CHART.axisInk }

function shortDay(key: string): string {
  // "3 Sep 2026" -> "3 Sep". The year is the same on every tick of a 30-day
  // window, so it is ink that carries no information.
  return formatDate(`${key}T12:00:00Z`).replace(/ \d{4}$/, '')
}

export default function SignupsChart({ data, days }: { data: SignupPoint[]; days: number }) {
  const total = data.reduce((s, d) => s + d.tutors + d.parents, 0)

  return (
    <ChartCard
      title="Signups by role"
      meaning={`New tutor and parent accounts, last ${days} days`}
      empty={
        total === 0
          ? `No new accounts in the last ${days} days. This chart fills in as people register.`
          : null
      }
      legend={[
        { label: 'Tutors', color: CHART.series[0] },
        { label: 'Parents', color: CHART.series[1] },
      ]}
      columns={[
        { key: 'day', label: 'Day' },
        { key: 'tutors', label: 'Tutors', numeric: true },
        { key: 'parents', label: 'Parents', numeric: true },
      ]}
      rows={data
        .filter((d) => d.tutors + d.parents > 0)
        .map((d) => ({ day: shortDay(d.day), tutors: d.tutors, parents: d.parents }))}
    >
      {/* The height includes the x-axis band, so the card never grows its own
          little scrollbar to reach the tick labels. */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0].payload as SignupPoint
              return (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] shadow-sm">
                  <p className="font-bold text-tm-navy">{shortDay(String(label))}</p>
                  <p className="text-slate-700">
                    {point.tutors} {point.tutors === 1 ? 'tutor' : 'tutors'} · {point.parents}{' '}
                    {point.parents === 1 ? 'parent' : 'parents'}
                  </p>
                </div>
              )
            }}
          />
          {/* The stroke is the surface gap, not an outline: it is painted in
              the card's own colour so touching segments separate without any
              added ink. */}
          <Bar
            dataKey="tutors"
            name="Tutors"
            stackId="signups"
            fill={CHART.series[0]}
            stroke={CHART.surface}
            strokeWidth={2}
            maxBarSize={18}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="parents"
            name="Parents"
            stackId="signups"
            fill={CHART.series[1]}
            stroke={CHART.surface}
            strokeWidth={2}
            maxBarSize={18}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
