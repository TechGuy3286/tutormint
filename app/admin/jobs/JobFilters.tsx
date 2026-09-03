'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import Typeahead from '@/components/search/Typeahead'
import type { AdminJobFilters } from '@/lib/adminJobs'

// Filters for the admin tuition list.
//
// suggest={false}, the same call /admin/users makes: the public suggestion
// index holds listed tutors and open jobs, so it is blind to closed jobs and
// jobs from suspended parents -- the exact rows an admin opens this screen to
// find. It is still a typeahead, because there is no search button anywhere on
// the platform.
//
// Labels are sr-only. Every control's first option already says what it is,
// and five visible headings above five selects is most of the weight of the
// bar.

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

export default function JobFilters({
  values,
  cities,
  subjects,
}: {
  values: AdminJobFilters
  cities: string[]
  subjects: { slug: string; name: string }[]
}) {
  const router = useRouter()
  const search = useSearchParams()

  const apply = (patch: Partial<Record<keyof AdminJobFilters, string | null>>) => {
    const next = new URLSearchParams(search?.toString() ?? '')
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const qs = next.toString()
    router.push(qs ? `/admin/jobs?${qs}` : '/admin/jobs')
  }

  const chips: { key: keyof AdminJobFilters; label: string }[] = []
  if (values.q) chips.push({ key: 'q', label: `“${values.q}”` })
  if (values.status) chips.push({ key: 'status', label: values.status })
  if (values.city) chips.push({ key: 'city', label: values.city })
  if (values.subject) {
    chips.push({
      key: 'subject',
      label: subjects.find((s) => s.slug === values.subject)?.name ?? values.subject,
    })
  }
  if (values.featured) {
    chips.push({ key: 'featured', label: values.featured === 'yes' ? 'Featured' : 'Not featured' })
  }

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <Typeahead
            initialQuery={values.q}
            placeholder="Search title or reference"
            ariaLabel="Search tuitions"
            suggest={false}
            onQueryChange={(q) => apply({ q: q || null })}
          />
        </div>

        <label className="block">
          <span className="sr-only">Status</span>
          <select
            className={FIELD}
            value={values.status}
            onChange={(e) => apply({ status: e.target.value || null })}
          >
            <option value="">Any status</option>
            <option value="open">Open</option>
            <option value="hired">Hired</option>
            <option value="closed">Closed</option>
          </select>
        </label>

        <label className="block">
          <span className="sr-only">City</span>
          <select
            className={FIELD}
            value={values.city}
            onChange={(e) => apply({ city: e.target.value || null })}
          >
            <option value="">Any city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Subject</span>
          <select
            className={FIELD}
            value={values.subject}
            onChange={(e) => apply({ subject: e.target.value || null })}
          >
            <option value="">Any subject</option>
            {subjects.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Featured</span>
          <select
            className={FIELD}
            value={values.featured}
            onChange={(e) => apply({ featured: e.target.value || null })}
          >
            <option value="">Featured or not</option>
            <option value="yes">Featured only</option>
            <option value="no">Not featured</option>
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => apply({ [c.key]: null })}
              className="inline-flex min-h-[28px] items-center gap-1 rounded-full bg-tm-bg px-2.5 text-[11px] font-bold text-tm-navy hover:bg-gray-100"
            >
              {c.label}
              <X size={11} aria-hidden />
              <span className="sr-only">Clear this filter</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
