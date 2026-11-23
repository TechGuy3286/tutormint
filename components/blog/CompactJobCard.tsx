import Link from 'next/link'
import { MapPin } from 'lucide-react'

import type { JobCardData } from '@/components/JobCard'
import { collapseLevels } from '@/lib/levelDisplay'
import { compactJobTitle, compactLevelSubjectLine } from '@/lib/liveJobsCore'
import { tuitionPath } from '@/lib/slugs'

// A COMPACT tuition card for blog posts (owner, 24 Nov 2026 — PR-20 B.4):
// title, city (and area), one short level / subject line and a "View" button.
// No description, no subject-chip grid, no Apply — the tuition page has all of
// that. A server component with no viewer state, so the cached post is the
// same for everyone.

export default function CompactJobCard({ job }: { job: JobCardData }) {
  const href = tuitionPath(job)
  const levels = collapseLevels(job.class_levels && job.class_levels.length > 0 ? job.class_levels : [job.class_level])
  const line = compactLevelSubjectLine(levels, job.subjects ?? [])
  const place = [job.area, job.city].map((x) => (x ?? '').trim()).filter(Boolean).join(', ')
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3" data-compact-job>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-bold text-tm-navy">{compactJobTitle(job)}</p>
        {place && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-700">
            <MapPin aria-hidden size={12} className="shrink-0" />
            <span className="truncate">{place}</span>
          </p>
        )}
        {line && <p className="mt-0.5 truncate text-xs text-gray-600">{line}</p>}
      </div>
      <Link
        prefetch={false}
        href={href}
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
        aria-label={`View ${compactJobTitle(job)}`}
      >
        View
      </Link>
    </div>
  )
}
