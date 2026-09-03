import Link from 'next/link'

import StatusChip from '@/components/admin/StatusChip'
import { Users } from 'lucide-react'
import TimeAgo from '@/components/TimeAgo'
import type { AdminJobRow } from '@/lib/adminJobs'

// One tuition in the admin list.
//
// The job_tx_id sits beside the title everywhere in admin, because that is the
// string a parent or a tutor quotes in a support message -- an admin should
// never have to open a job to find out whether it is the one they were asked
// about.

export default function JobRow({ row }: { row: AdminJobRow }) {
  return (
    <li>
      <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <Link
              href={`/admin/jobs/${row.id}`}
              className="inline-flex min-h-[28px] items-center text-sm font-black text-tm-navy hover:text-tm-red hover:underline"
            >
              {row.title}
            </Link>
            <p className="font-mono text-[10px] text-gray-500">{row.jobTxId ?? row.id}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {row.isFeatured && (
              <span className="rounded-full bg-tm-gold px-2 py-0.5 text-[10px] font-black text-tm-navy">
                Featured
              </span>
            )}
            <StatusChip status={row.status} />
          </div>
        </div>

        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
          <dd>
            {/* The parent's name goes to their ADMIN member page, per the rule
                that in admin a name is an admin link. The public page is a
                separate, explicit link on the detail screen. */}
            {row.parentId ? (
              <Link
                href={`/admin/users/${row.parentId}`}
                className="font-semibold text-slate-700 hover:text-tm-red hover:underline"
              >
                {row.parentName}
              </Link>
            ) : (
              <span className="font-semibold text-slate-700">{row.parentName}</span>
            )}
          </dd>
          {(row.area || row.city) && (
            <>
              <dd aria-hidden>·</dd>
              <dd>{[row.area, row.city].filter(Boolean).join(', ')}</dd>
            </>
          )}
          {row.classLevel && (
            <>
              <dd aria-hidden>·</dd>
              <dd>{row.classLevel}</dd>
            </>
          )}
          <dd aria-hidden>·</dd>
          <dd className="inline-flex items-center gap-1">
            <Users size={11} aria-hidden />
            {row.applicantCount} {row.applicantCount === 1 ? 'applicant' : 'applicants'}
          </dd>
          <dd aria-hidden>·</dd>
          <dd>
            <TimeAgo iso={row.createdAt} />
          </dd>
        </dl>

        {row.subjects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.subjects.slice(0, 6).map((s) => (
              <span
                key={s}
                className="rounded-full bg-tm-bg px-2 py-0.5 text-[10px] font-semibold text-slate-700"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}
