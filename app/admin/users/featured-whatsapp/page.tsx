import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadFeaturedWhatsapp } from '@/lib/staffOutreach'
import { formatDateTime } from '@/lib/datetime'
import FeaturedSendRow from './FeaturedSendRow'

// Admin → People → Featured WhatsApp (owner, 8 Oct 2026). Featured tutors with
// new matching open tuitions since their last WhatsApp send — the same matching
// rule as the in-app and email match alerts. The list is cut at 10:00 Pakistan
// time each day, so it is stable through the day; tutors with nothing new are
// hidden from the to-send list. Owner, admin, Operations and Tuitions staff.

export const dynamic = 'force-dynamic'

export default async function FeaturedWhatsappPage() {
  await requireAdminRole(...SCREEN_ACCESS.featuredWhatsapp)
  const { cutoff, rows } = await loadFeaturedWhatsapp()
  const toSend = rows.filter((r) => r.matches.length > 0)
  const dayAgo = Date.now() - 86_400_000
  const sentRecently = rows.filter((r) => r.lastSent && Date.parse(r.lastSent.at) > dayAgo && r.matches.length === 0)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Featured WhatsApp</h1>
        <p className="text-xs text-gray-500">
          Featured tutors with new matching tuitions since their last WhatsApp. The list refreshes once a day at 10:00
          Pakistan time (this list: tuitions up to {formatDateTime(cutoff)}). &ldquo;Send on WhatsApp&rdquo; records the
          send first, so the same tuitions are never sent twice. No parent contact details are ever included.
        </p>
      </header>

      {toSend.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No Featured tutor has new matches right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {toSend.map((r) => (
            <FeaturedSendRow key={r.tutorId} row={r} />
          ))}
        </ul>
      )}

      {sentRecently.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-black text-tm-navy">Sent in the last 24 hours</h2>
          <ul className="space-y-1 text-xs text-slate-700">
            {sentRecently.map((r) => (
              <li key={r.tutorId}>
                {r.name} · Sent {formatDateTime(r.lastSent!.at)} by {r.lastSent!.byEmail ?? 'staff'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
