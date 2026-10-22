'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { CityOwnerSetting } from '@/lib/cityOwners'
import type { StaffOption } from '@/lib/applicationTracking'

const NONE = '__none__'
const FIELD = 'min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-tm-navy'

export default function CityOwnersClient({
  rows,
  staff,
  cities,
  canEdit,
}: {
  rows: CityOwnerSetting[]
  staff: StaffOption[]
  cities: string[]
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [newCity, setNewCity] = useState('')
  const [newStaff, setNewStaff] = useState('')
  const taken = useMemo(() => new Set(rows.map((r) => r.city)), [rows])

  async function save(city: string, staffId: string | null) {
    setBusy(city)
    const { ok, data } = await adminFetch<{ error?: string; reassigned?: number }>('/api/admin/city-owners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, staffId }),
    })
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    const n = data?.reassigned ?? 0
    toast.success(`${city} saved${n ? ` · ${n} ${n === 1 ? 'tuition' : 'tuitions'} moved` : ''}`)
    setNewCity('')
    setNewStaff('')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {!canEdit && <p className="rounded-xl bg-tm-tint-navy p-3 text-xs font-bold text-tm-navy">View only — only the Owner changes city owners.</p>}
      <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {rows.map((r) => (
          <li key={r.city} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="font-black text-tm-navy">{r.city}</span>
            {canEdit ? (
              <select
                aria-label={`Owner of ${r.city}`}
                value={r.staffId ?? NONE}
                disabled={busy === r.city}
                onChange={(e) => save(r.city, e.target.value === NONE ? null : e.target.value)}
                className={FIELD}
              >
                <option value={NONE}>No owner (site Owner)</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {r.staffId && !staff.some((s) => s.id === r.staffId) && <option value={r.staffId}>{r.staffName}</option>}
              </select>
            ) : (
              <span className="font-bold text-slate-700">{r.staffName ?? 'No owner (site Owner)'}</span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="p-4 text-center text-xs text-gray-600">No city owners yet.</li>}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs">
          <span className="font-bold text-slate-700">Add a city</span>
          <select aria-label="City" value={newCity} onChange={(e) => setNewCity(e.target.value)} className={FIELD}>
            <option value="">Choose a city…</option>
            {cities
              .filter((c) => !taken.has(c))
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
          <select aria-label="Owner" value={newStaff} onChange={(e) => setNewStaff(e.target.value)} className={FIELD}>
            <option value="">Choose a staff member…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!newCity || !newStaff || busy !== null}
            onClick={() => save(newCity, newStaff)}
            className="min-h-[40px] rounded-lg bg-tm-navy px-3 font-bold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
