'use client'

import { useMemo, useState } from 'react'

import { formatDate } from '@/lib/datetime'
import {
  CREDITED_BY_LABEL,
  EMPTY_FILTERS,
  PARENT_PATH,
  TUTOR_PATH,
  filterRows,
  type CountedFilter,
  type Filters,
  type MonthFilter,
  type MySignupRow,
  type MyStep,
  type RoleFilter,
} from '@/lib/mySignupsCore'

// The sign-up rows (owner, 16 Oct 2026): Tuitions → My sign-ups, and the lists
// behind the numbers on Team activity — the same columns in both. Rows arrive
// already cut to what the viewer may see (lib/mySignups); this only filters,
// searches and sorts them in the browser. A WhatsApp tap opens WhatsApp and
// writes the staff activity log (/api/admin/my-signups/whatsapp).

const STEP_OPTIONS: { key: MyStep | 'all'; label: string }[] = [
  { key: 'all', label: 'Any step' },
  ...[...TUTOR_PATH, ...PARENT_PATH.filter((s) => s.key === 'posted')].map((s) => ({ key: s.key, label: s.label })),
]

function logTap(memberId: string, nextStep: string | null) {
  try {
    void fetch('/api/admin/my-signups/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, nextStep }),
      keepalive: true,
    })
  } catch {
    /* the log never blocks the message */
  }
}

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <label className="text-[11px] font-semibold text-gray-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-0.5 block min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs text-slate-800"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function SignupRows({ rows, showFilters = false }: { rows: MySignupRow[]; showFilters?: boolean }) {
  const [f, setF] = useState<Filters>(EMPTY_FILTERS)
  const shown = useMemo(() => filterRows(rows, f, Date.now()), [rows, f])
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((cur) => ({ ...cur, [k]: v }))

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3">
          <label className="min-w-[180px] flex-1 text-[11px] font-semibold text-gray-600">
            Search by name or phone
            <input
              type="search"
              value={f.q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Name or 03xx…"
              className="mt-0.5 block min-h-[40px] w-full rounded-lg border border-gray-200 px-2 text-xs text-slate-800"
            />
          </label>
          <Select<RoleFilter>
            label="Who"
            value={f.role}
            onChange={(v) => set('role', v)}
            options={[
              { key: 'all', label: 'Tutors and parents' },
              { key: 'tutor', label: 'Tutors' },
              { key: 'parent', label: 'Parents' },
            ]}
          />
          <Select<MyStep | 'all'> label="Step" value={f.step} onChange={(v) => set('step', v)} options={STEP_OPTIONS} />
          <Select<CountedFilter>
            label="Counted"
            value={f.counted}
            onChange={(v) => set('counted', v)}
            options={[
              { key: 'all', label: 'All' },
              { key: 'counted', label: 'Counted' },
              { key: 'not_counted', label: 'Not counted' },
            ]}
          />
          <Select<MonthFilter>
            label="Signed up"
            value={f.month}
            onChange={(v) => set('month', v)}
            options={[
              { key: 'all', label: 'Any time' },
              { key: 'this', label: 'This month' },
              { key: 'last', label: 'Last month' },
            ]}
          />
        </div>
      )}

      <p className="text-[11px] text-gray-600">
        {shown.length} of {rows.length} {rows.length === 1 ? 'person' : 'people'}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nobody matches these filters.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((r) => (
            <li key={`${r.kind}-${r.memberId}`} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-tm-navy">{r.name}</p>
                  <p className="text-gray-600">
                    {r.role === 'tutor' ? 'Tutor' : 'Parent'}
                    {r.city ? ` · ${r.city}` : ''}
                  </p>
                </div>
                {r.counted ? (
                  <span className="rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep">Counted</span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                    Not counted · {r.notCountedLabel}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-800">
                <dt className="text-gray-600">Phone</dt>
                <dd className="tabular-nums">{r.phone ?? '—'}</dd>
                {r.kind === 'credit' && (
                  <>
                    <dt className="text-gray-600">Email</dt>
                    <dd className="break-all">{r.email ?? '—'}</dd>
                    <dt className="text-gray-600">Signed up</dt>
                    <dd>{r.signedUpAt ? formatDate(r.signedUpAt) : '—'}</dd>
                  </>
                )}
                <dt className="text-gray-600">Credited by</dt>
                <dd>{r.creditedBy ? (r.kind === 'claim' ? 'Your claim' : CREDITED_BY_LABEL[r.creditedBy]) : '—'}</dd>
                {r.kind === 'credit' && (
                  <>
                    <dt className="text-gray-600">Step</dt>
                    <dd className="font-bold">{r.stepLabel}</dd>
                    <dt className="text-gray-600">Paid</dt>
                    <dd>{r.paid && r.paidAt ? `Yes, ${formatDate(r.paidAt)}` : 'No'}</dd>
                    <dt className="text-gray-600">Next step for them</dt>
                    <dd className="font-bold text-tm-navy">{r.nextStepLabel}</dd>
                  </>
                )}
              </dl>
              {r.waLink && (
                <a
                  href={r.waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => logTap(r.memberId, r.nextStep)}
                  className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover"
                >
                  WhatsApp
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
