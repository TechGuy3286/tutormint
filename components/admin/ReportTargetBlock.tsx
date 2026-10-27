import Link from 'next/link'

import type { ReportTarget, ReporterApplication, ReporterFacts } from '@/lib/reportCardCore'
import { reporterApplicationLines, reporterStatusLine, tuitionLinkText } from '@/lib/reportCardCore'
import { TEAM_POSTER_LABEL } from '@/lib/teamPosterCore'
import { formatDate } from '@/lib/datetime'

// On every Reports & flags card (owner, 27 Oct 2026): the EXACT tuition or
// profile reported (TM number and title, with links), the reporter's paid /
// verified status, and their applications on that tuition with forward
// status. Plain markup, no hooks — the queue and the tests render the same.

export default function ReportTargetBlock({
  target,
  reporter,
  applications,
}: {
  target: ReportTarget
  reporter: ReporterFacts | null
  applications: ReporterApplication[]
}) {
  const appLines = reporterApplicationLines(applications, (iso) => formatDate(iso))
  return (
    <div className="space-y-1.5 rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed text-slate-700" data-report-target={target.kind}>
      {target.kind === 'tuition' && (
        <p>
          <span className="font-bold text-gray-600">Tuition reported: </span>
          <Link href={target.adminHref} className="font-black text-tm-navy hover:underline" data-report-link="">
            {tuitionLinkText(target.refId, target.title)}
          </Link>
          {target.publicHref && (
            <>
              {' · '}
              <Link href={target.publicHref} target="_blank" rel="noreferrer" className="font-bold text-tm-red hover:underline">
                Public page ↗
              </Link>
            </>
          )}
          {target.postedByTeam && <span className="ml-1 font-bold text-tm-navy">· {TEAM_POSTER_LABEL}</span>}
        </p>
      )}
      {target.kind === 'profile' && (
        <p>
          <span className="font-bold text-gray-600">Profile reported: </span>
          <Link href={target.adminHref} className="font-black text-tm-navy hover:underline" data-report-link="">
            {target.name}
          </Link>
          {target.publicHref && (
            <>
              {' · '}
              <Link href={target.publicHref} target="_blank" rel="noreferrer" className="font-bold text-tm-red hover:underline">
                Public profile ↗
              </Link>
            </>
          )}
        </p>
      )}
      {target.kind === 'conversation' && target.adminHref && (
        <p>
          <span className="font-bold text-gray-600">Conversation with: </span>
          <Link href={target.adminHref} className="font-black text-tm-navy hover:underline" data-report-link="">
            {target.name ?? 'Member'}
          </Link>
        </p>
      )}
      {target.kind === 'unknown' && <p className="text-gray-500">The reported item is no longer available.</p>}

      <p>
        <span className="font-bold text-gray-600">Reporter: </span>
        {reporterStatusLine(reporter)}
      </p>
      {target.kind === 'tuition' && (
        <div>
          <span className="font-bold text-gray-600">Their application on this tuition: </span>
          {appLines.length === 0 ? (
            <span>none</span>
          ) : (
            <ul className="list-disc pl-5">
              {appLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
