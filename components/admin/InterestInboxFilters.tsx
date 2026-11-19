'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// The Parent interest inbox's filters (PR-10, owner 19 Nov 2026): city,
// paid/unpaid and — for the roles that see every row — assigned staff. Each
// select applies at once (no search button); the list resets to its first page.

type Opt = { value: string; label: string }

export default function InterestInboxFilters({ cities, staff, showStaff }: { cities: string[]; staff: Opt[]; showStaff: boolean }) {
  const router = useRouter()
  const path = usePathname()
  const sp = useSearchParams()

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('n')
    router.replace(`${path}?${next.toString()}`, { scroll: false })
  }

  const cls = 'min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-slate-800'
  return (
    <div className="flex flex-wrap gap-2" data-inbox-filters="">
      <label className="sr-only" htmlFor="inbox-city">
        City
      </label>
      <select id="inbox-city" className={cls} value={sp.get('city') ?? ''} onChange={(e) => set('city', e.target.value)}>
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="inbox-pay">
        Paid or unpaid
      </label>
      <select id="inbox-pay" className={cls} value={sp.get('pay') ?? ''} onChange={(e) => set('pay', e.target.value)}>
        <option value="">Paid and unpaid</option>
        <option value="paid">Paid</option>
        <option value="unpaid">Unpaid</option>
      </select>
      {showStaff && (
        <>
          <label className="sr-only" htmlFor="inbox-staff">
            Assigned staff
          </label>
          <select id="inbox-staff" className={cls} value={sp.get('staff') ?? 'mine'} onChange={(e) => set('staff', e.target.value === 'mine' ? '' : e.target.value)}>
            <option value="mine">My rows</option>
            <option value="all">All staff</option>
            {staff.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
