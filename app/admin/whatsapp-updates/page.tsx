import Link from 'next/link'

import LoadMoreLink from '@/components/admin/LoadMoreLink'
import WaUpdateRow from '@/components/admin/WaUpdateRow'
import HeldActivityPanel from '@/components/admin/HeldActivityPanel'
import InterestInboxRow from '@/components/admin/InterestInboxRow'
import InterestInboxFilters from '@/components/admin/InterestInboxFilters'
import { loadHeldActivity } from '@/lib/parentInterest'
import { requireAdminRole, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminActor } from '@/lib/adminAuth'
import { seesAllRows } from '@/lib/staffAllRows'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'
import { formatDateTime, formatTime } from '@/lib/datetime'
import { WA_WEEKLY_CAP } from '@/lib/tutorTeasersCore'
import { loadWaQueue } from '@/lib/waUpdates'
import { loadInterestInbox, type InboxRow } from '@/lib/interestInbox'
import { inboxView } from '@/lib/interestInboxView'
import { INBOX_TABS, staffFilter, WAIT_LABEL, type InboxTab } from '@/lib/interestInboxCore'

// People → WhatsApp updates (PR-06, owner 18 Nov 2026), two tabs:
//   Today            paid tutors' news: a parent opened or was sent their
//                    application, and on Mondays their weekly summary. The
//                    Owner, the Project Manager and Backend Support
//                    (SCREEN_ACCESS.waUpdates). The Owner also sees "Held
//                    activity" (PR-08).
//   Parent interest  (PR-10, owner 19 Nov 2026) one row per tutor from every
//                    real parent's activity in the last 30 days — demo
//                    requests, message attempts, shortlists, views — hottest
//                    first; To send / Sent / New activity since sent; filters
//                    city, paid/unpaid, assigned staff (city owner, else the
//                    Owner). SCREEN_ACCESS.interestInbox; Managers and
//                    Tuitions staff see and send only their own rows.
// No tutor phone, CNIC or email on this page — the number goes only into the
// WhatsApp address at Send. Parent phones show masked (logged Show).

export const dynamic = 'force-dynamic'

type SP = { tab?: string; it?: string; city?: string; pay?: string; staff?: string; n?: string }

export default async function WhatsAppUpdatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.interestInbox)
  const sp = await searchParams
  const seesToday = roleSatisfies(actor.adminRole, SCREEN_ACCESS.waUpdates)
  const tab = !seesToday || sp.tab === 'interest' ? 'interest' : 'today'

  const tabLink = (t: 'today' | 'interest', label: string) => (
    <Link
      href={t === 'today' ? '/admin/whatsapp-updates' : '/admin/whatsapp-updates?tab=interest'}
      aria-current={tab === t ? 'page' : undefined}
      className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${tab === t ? 'bg-tm-navy text-white' : 'border border-gray-200 bg-white text-tm-navy'}`}
    >
      {label}
    </Link>
  )

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-lg font-black text-tm-navy">WhatsApp updates</h2>
        {seesToday && (
          <nav className="flex flex-wrap gap-2" aria-label="WhatsApp updates">
            {tabLink('today', 'Today')}
            {tabLink('interest', 'Parent interest')}
          </nav>
        )}
      </header>
      {tab === 'today' ? <TodayTab actor={actor} n={sp.n} /> : <InterestTab actor={actor} sp={sp} />}
    </div>
  )
}

async function TodayTab({ actor, n }: { actor: AdminActor; n?: string }) {
  const isOwner = actor.adminRole === 'owner'
  const [queue, held] = await Promise.all([loadWaQueue(), isOwner ? loadHeldActivity() : Promise.resolve(null)])
  const page = pageSlice(queue.rows, shownCount(n))
  const sentToday = queue.rows.length - queue.toSend
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-gray-600">
          Paid tutors with real news today: a parent opened or was sent their application, and on Mondays their weekly summary. Parent
          shortlists, messages, demo requests and views (paid and unpaid tutors) are on the Parent interest tab. Send opens WhatsApp with
          the message ready and logs who sent it. Each tutor gets at most one a day and {WA_WEEKLY_CAP} a week across both tabs; tutors who
          turned updates off are not listed.
        </p>
        <p className="text-xs font-bold text-slate-800">
          {queue.toSend} to send today · {sentToday} sent today · {queue.eligible} paid {queue.eligible === 1 ? 'tutor' : 'tutors'} eligible ·{' '}
          {queue.optedOut} turned updates off
        </p>
      </div>

      {page.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          Nothing to send right now. New rows appear when a parent opens a tutor&apos;s application, and every Monday after the weekly summary
          goes out — meanwhile, open the Parent interest tab.
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

const isTab = (v: string | undefined): v is InboxTab => v === 'to_send' || v === 'sent' || v === 'new_since_sent'

async function InterestTab({ actor, sp }: { actor: AdminActor; sp: SP }) {
  const inbox = await loadInterestInbox()
  const seesAll = await seesAllRows(actor, SCREEN_ACCESS.interestInboxAll)
  const mayWrite = roleMayWrite(actor.adminRole, SCREEN_ACCESS.interestInbox)
  const canReveal = roleSatisfies(actor.adminRole, SCREEN_ACCESS.memberContactReveal)
  const who = staffFilter(seesAll, actor.id, sp.staff)
  const it: InboxTab = isTab(sp.it) ? sp.it : 'to_send'

  const scoped = inbox.rows.filter(
    (r) =>
      (who.mode === 'all' || r.assigneeId === who.staffId) &&
      (!sp.city || r.city === sp.city) &&
      (sp.pay === 'paid' ? r.paid : sp.pay === 'unpaid' ? !r.paid : true),
  )
  const inTab = scoped.filter((r) => r.tab === it)
  // Ready rows first (hottest first, as loaded), then the ones a cap holds
  // back; the Sent tab newest send first.
  const ordered: InboxRow[] =
    it === 'sent' ? [...inTab].sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '')) : [...inTab.filter((r) => !r.wait), ...inTab.filter((r) => r.wait)]
  const page = pageSlice(ordered, shownCount(sp.n))
  const tabCount = (t: InboxTab) => scoped.filter((r) => r.tab === t).length
  const ready = scoped.filter((r) => r.tab !== 'sent' && !r.wait)
  const waiting = scoped.filter((r) => r.tab !== 'sent' && r.wait)
  const nowMs = Date.now()

  const subHref = (t: InboxTab) => {
    const q = new URLSearchParams()
    q.set('tab', 'interest')
    if (t !== 'to_send') q.set('it', t)
    for (const k of ['city', 'pay', 'staff'] as const) if (sp[k]) q.set(k, sp[k]!)
    return `/admin/whatsapp-updates?${q.toString()}`
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs text-gray-600">
          One row per tutor from real parents&apos; activity in the last 30 days — demo requests, message attempts, shortlists and profile
          views — hottest first. Staff and test accounts and held activity are never used. Each row has one ready WhatsApp message (parents
          shown only as a blurred name and city); Send logs who sent it. A sent tutor comes back only with new parent activity. Rows go to
          the city&apos;s owner (City owners), else the Owner. At most one WhatsApp a tutor a day, {WA_WEEKLY_CAP} a week, and{' '}
          {inbox.unpaidCap} unpaid tutors a day.
        </p>
        <p className="text-xs font-bold text-slate-800" data-inbox-counts="">
          {ready.length} ready to send · {waiting.length} waiting beyond today&apos;s cap · {ready.filter((r) => r.pendingKinds.includes('demo')).length} with a demo request
        </p>
      </div>

      <InterestInboxFilters
        cities={inbox.cities}
        staff={inbox.staff.map((s) => ({ value: s.id, label: s.name }))}
        showStaff={seesAll}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Parent interest">
        {INBOX_TABS.map((t) => (
          <Link
            key={t.key}
            href={subHref(t.key)}
            aria-current={it === t.key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-3 text-xs font-bold ${it === t.key ? 'bg-tm-navy text-white' : 'border border-gray-200 bg-white text-tm-navy'}`}
          >
            {t.label} ({tabCount(t.key)})
          </Link>
        ))}
      </nav>

      {page.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          {it === 'sent'
            ? 'No tutors sent yet in this view. Send one from the To send tab.'
            : it === 'new_since_sent'
              ? 'No new parent activity since the last messages. Check the To send tab.'
              : who.mode === 'one' && who.staffId === actor.id && seesAll
                ? 'Nothing to send in your cities right now. Choose "All staff" to see every row.'
                : 'Nothing to send right now. New rows appear as parents view, shortlist, message or ask tutors for a demo.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {page.rows.map((r) => (
            <li key={r.tutorId}>
              <InterestInboxRow
                row={inboxView(r, actor, nowMs, (w) => WAIT_LABEL[w])}
                canSend={mayWrite && (seesAll || r.assigneeId === actor.id)}
                canReveal={canReveal}
                from="inbox"
                cap={WA_WEEKLY_CAP}
              />
            </li>
          ))}
        </ul>
      )}
      {page.total > 0 && <LoadMoreLink shown={page.shown} total={page.total} noun="tutors" />}
    </div>
  )
}
