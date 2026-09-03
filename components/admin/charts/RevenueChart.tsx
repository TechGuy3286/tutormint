'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import ChartCard from '@/components/admin/charts/ChartCard'
import { CHART } from '@/lib/brand'
import type { RevenueSlice } from '@/lib/adminOverview'

// Revenue by plan, this calendar month.
//
// ONE SERIES, ONE HUE. The bars are one measure across a handful of plans, so
// colour has no job here — length carries the magnitude and the plan name is
// on the axis. Four categorical hues would be the commonest chart mistake
// there is: eight colours for a story that is one number each. A single series
// also needs no legend box; the title already says what is plotted.
//
// HORIZONTAL, because plan names are words. Rotated 45° labels under vertical
// columns are unreadable on a phone and collide at every width.
//
// The value is direct-labelled at the bar tip — four labels, not forty, which
// is what makes direct labels work — so the amounts are readable without
// hovering anything.

const TICK = { fontSize: 10, fill: CHART.axisInk }

const rs = (n: number) => `Rs. ${n.toLocaleString('en-PK')}`

export default function RevenueChart({
  data,
  period,
  total,
}: {
  data: RevenueSlice[]
  period: string
  total: number
}) {
  return (
    <ChartCard
      title="Revenue by plan"
      meaning={`Approved payments this month · ${rs(total)} total`}
      empty={
        data.length === 0
          ? `No payments have been approved since ${period}-01. This chart fills in as plans are bought or confirmed.`
          : null
      }
      columns={[
        { key: 'plan', label: 'Plan' },
        { key: 'payments', label: 'Payments', numeric: true },
        { key: 'amount', label: 'Revenue', numeric: true },
      ]}
      rows={data.map((d) => ({
        plan: d.plan,
        payments: d.payments,
        amount: rs(d.amount),
      }))}
    >
      {/* Height follows the row count so the plot never squeezes and the axis
          band is always inside the card. */}
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 46 + 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 76, bottom: 0, left: 4 }}
        >
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} horizontal={false} />
          <XAxis
            type="number"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            tickFormatter={(v: number) => v.toLocaleString('en-PK')}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="plan"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={118}
          />
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const s = payload[0].payload as RevenueSlice
              return (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] shadow-sm">
                  <p className="font-bold text-tm-navy">{s.plan}</p>
                  <p className="text-slate-700">
                    {rs(s.amount)} from {s.payments} {s.payments === 1 ? 'payment' : 'payments'}
                  </p>
                </div>
              )
            }}
          />
          {/* Entry animation off. Recharts grows a bar from zero on mount and
              again on every resize, so a chart that has just been re-laid out
              is briefly a blank plot -- which is indistinguishable from the
              empty state two lines above and is exactly what a screenshot
              catches. An admin dashboard has nothing to gain from the motion
              either. */}
          <Bar
            dataKey="amount"
            fill={CHART.single}
            maxBarSize={22}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            {/* Outside the bar end, never inside it: the shortest bar here can
                be a few pixels wide and an inside label would be clipped. */}
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(v) => rs(Number(v))}
              style={{ fontSize: 10, fill: CHART.axisInk }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
