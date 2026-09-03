import { formatDateTime } from '@/lib/datetime'
import type { TimelineRowData } from '@/lib/adminQueues'

// One row of a member's timeline, rendered identically whether the server drew
// it or the browser appended it. Same reason MemberRow exists: two renderings
// of one row is how a list develops a visible seam at the page boundary.
//
// PRIVACY, restated where it is enforced: a message event carries a thread id
// and nothing else. `meta` is rendered as compact key/value pairs, and
// lib/activityLog.ts never puts a message body in it -- so there is no body
// here to leak even if this component wanted one.

export type TimelineEvent = TimelineRowData

/** The event vocabulary. Beside the thing that renders it, so the server and
    the browser cannot name the same event differently. */
export const EVENT_LABEL: Record<string, string> = {
  registered: 'Registered',
  login: 'Signed in',
  otp_verified: 'Verified their phone',
  profile_updated: 'Updated their profile',
  completion_changed: 'Profile completion changed',
  subjects_changed: 'Changed their subjects',
  document_uploaded: 'Uploaded a document',
  video_submitted: 'Submitted a video',
  verification_submitted: 'Submitted verification',
  verification_decision_received: 'Verification decision',
  video_visibility_changed: 'Video visibility changed',
  job_posted: 'Posted a tuition',
  job_edited: 'Edited a tuition',
  job_closed: 'Closed a tuition',
  application_submitted: 'Applied to a tuition',
  application_withdrawn: 'Withdrew an application',
  demo_requested: 'Requested a demo',
  demo_accepted: 'Accepted a demo',
  demo_declined: 'Declined a demo',
  demo_completed: 'Completed a demo',
  message_sent: 'Sent a message',
  shortlist_added: 'Shortlisted a tutor',
  shortlist_removed: 'Removed a shortlist',
  profile_viewed: 'Viewed a profile',
  search_performed: 'Searched',
  payment_submitted: 'Submitted a payment',
  payment_rejected: 'Payment rejected',
  plan_purchased: 'Bought a plan',
  plan_expiring: 'Plan expiring',
  plan_granted: 'Plan granted',
  plan_revoked: 'Plan revoked',
  plan_expired: 'Plan expired',
  blocked: 'Blocked someone',
  blocked_by: 'Was blocked',
  unblocked: 'Unblocked someone',
  reported: 'Reported someone',
  reported_by: 'Was reported',
  report_resolved: 'Report resolved',
  warned: 'Warned',
  suspended: 'Suspended',
  unsuspended: 'Reinstated',
  staff_created: 'Staff account created',
  staff_role_changed: 'Staff role changed',
  staff_suspended: 'Staff access suspended',
  staff_reactivated: 'Staff access restored',
}

const TONE: Record<string, string> = {
  suspended: 'bg-tm-tint-red text-tm-red',
  warned: 'bg-tm-tint-gold text-tm-gold-ink',
  unsuspended: 'bg-tm-tint-green text-tm-green-deep',
  plan_purchased: 'bg-tm-tint-green text-tm-green-deep',
  plan_expired: 'bg-slate-100 text-slate-700',
  reported_by: 'bg-tm-tint-gold text-tm-gold-ink',
}

export default function TimelineRow({ event: e }: { event: TimelineEvent }) {
  return (
    <li className="flex min-h-[44px] flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl border border-gray-200 bg-white p-3">
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
          TONE[e.event] ?? 'bg-slate-100 text-slate-700'
        }`}
      >
        {e.event.replace(/_/g, ' ')}
      </span>
      <span className="min-w-0 flex-1 text-xs font-semibold text-tm-navy">
        {EVENT_LABEL[e.event] ?? e.event}
      </span>
      <span className="shrink-0 text-[11px] text-gray-500">{formatDateTime(e.at)}</span>
      {Object.keys(e.meta).length > 0 && (
        <p className="w-full break-words text-[11px] leading-relaxed text-gray-500">
          {Object.entries(e.meta)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' · ')}
        </p>
      )}
    </li>
  )
}
