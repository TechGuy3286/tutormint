import LoadMoreLink from '@/components/admin/LoadMoreLink'
import WaUpdateRow from '@/components/admin/WaUpdateRow'
import HeldActivityPanel from '@/components/admin/HeldActivityPanel'
import { loadHeldActivity } from '@/lib/parentInterest'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'
import { formatDateTime, formatTime } from '@/lib/datetime'
import { WA_WEEKLY_CAP } from '@/lib/tutorTeasersCore'
import { loadWaQueue } from '@/lib/waUpdates'

// People → WhatsApp updates (PR-06, owner 18 Nov 2026; PR-08 adds unpaid tutors
// and the Owner-only "Held activity" panel; rules lib/tutorTeasersCore,
// reads lib/waUpdates). Paid tutors with something worth a WhatsApp message
// today: a parent opened one of their applications (today or yesterday), and on
// Mondays their weekly summary. Each row has the ready message and a Send button
// (opens WhatsApp; logged with staff and time; Undo the same day). At most two
// sends a tutor a week; opted-out tutors are never listed. No phone, CNIC or
// email on this page — the number goes only into the WhatsApp address at Send.

export const dynamic = 'force-dynamic'

export default async function WhatsAppUpdatesPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.waUpdates)
  const sp = await searchParams
  const isOwner = actor.adminRole === 'owner'
  const [queue, held] = await Promise.all([loadWaQueue(), isOwner ? loadHeldActivity() : Promise.resolve(null)])
  const page = pageSlice(queue.rows, shownCount(sp.n))
  const sentToday = queue.rows.length - queue.toSend

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">WhatsApp updates</h2>
        <p className="text-xs text-gray-600">
          Tutors with real news today. Paid tutors: a parent opened or was sent their application, and on Mondays their weekly summary.
          Unpaid tutors (at most {queue.unpaidCap} a day): parents shortlisted or tried to contact them, or viewed their profile — Approved,
          fee pending first, then Documents missing. Send opens WhatsApp with the message ready and logs who sent it. Each tutor gets at most{' '}
          {WA_WEEKLY_CAP} a week; tutors who turned updates off are not listed.
        </p>
        <p className="text-xs font-bold text-slate-800">
          {queue.toSend} to send today ({queue.paidToSend} paid · {queue.unpaidToSend} unpaid) · {sentToday} sent today · {queue.eligible} paid{' '}
          {queue.eligible === 1 ? 'tutor' : 'tutors'} eligible · {queue.optedOut} turned updates off
        </p>
      </header>

      {page.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          Nothing to send right now. New rows appear when a parent opens a tutor&apos;s application, and every Monday after the weekly summary
          goes out — check back then, or open People to follow up tutors.
        </p>
      ) : (
        <ul className="space-y-2">
          {page.rows.map((r) => (
            <li key={r.tutorId}>
              <WaUpdateRow
                row={{
                  tutorId: r.tutorId,
                  name: r.name,
                  city: r.city,
                  state: r.state === 'to_send' ? 'to_send' : 'sent_today',
                  message: r.message,
                  weekCount: r.weekCount,
                  kinds: [...new Set(r.items.map((i) => i.kind))],
                  unpaid: r.unpaid,
                  priority: r.priority,
                  sent: r.sentToday ? { id: r.sentToday.id, by: r.sentToday.by, time: formatTime(r.sentToday.at), mine: r.sentToday.staffId === actor.id || actor.adminRole === 'owner' } : null,
                }}
                cap={WA_WEEKLY_CAP}
              />
            </li>
          ))}
        </ul>
      )}
      {page.total > 0 && <LoadMoreLink shown={page.shown} total={page.total} noun="tutors" />}

      {held && (
        <HeldActivityPanel
          rows={held.map((h) => ({
            parentId: h.parentId,
            name: h.name,
            status: h.status,
            detected: formatDateTime(h.detectedAt),
            shortlists: h.shortlists,
            attempts: h.attempts,
            heldEvents: h.heldEvents,
          }))}
        />
      )}
    </div>
  )
}
