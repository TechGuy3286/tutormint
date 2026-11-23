import Link from 'next/link'

import { requireAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { formatDateTime } from '@/lib/datetime'
import { loadContactMessages } from '@/lib/contactForm'
import ContactMessageActions from './ContactMessageActions'

// Team inbox → Contact form (owner, 24 Nov 2026 — PR-20 Part A). Every message
// sent from tutormint.org/contact, newest first, new ones on top. The sender's
// mobile / email is masked; Show reveals it and is logged. Done moves a
// message out of "New". Same access as the Team inbox.

export const dynamic = 'force-dynamic'

export default async function ContactMessagesPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.inbox)
  const canWrite = roleMayWrite(actor.adminRole, SCREEN_ACCESS.inbox)
  const all = await loadContactMessages()
  const fresh = all.filter((m) => m.status === 'new')
  const done = all.filter((m) => m.status === 'done')

  const list = (rows: typeof all) => (
    <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
      {rows.map((m) => (
        <li key={m.id} className="space-y-2 p-3 text-sm" data-contact-row="">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-bold text-tm-navy">
              {m.name}
              {m.memberId && (
                <Link href={`/admin/users/${m.memberId}?from=/admin/inbox/contact`} className="ml-2 text-xs font-bold text-tm-red hover:underline">
                  Member page
                </Link>
              )}
            </p>
            <span className="text-xs text-gray-600">{formatDateTime(m.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-slate-700">{m.message}</p>
          <ContactMessageActions id={m.id} masked={m.maskedContact} done={m.status === 'done'} canWrite={canWrite} />
        </li>
      ))}
    </ul>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Contact form</h1>
        <p className="text-xs text-gray-600">
          Messages sent from the Contact us page. Each one is also emailed to support. Reply on WhatsApp or email, then press Done.
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">New ({fresh.length})</h2>
        {fresh.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
            No new messages. New ones appear here and in the support mailbox — nothing to do until then.
          </p>
        ) : (
          list(fresh)
        )}
      </section>
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-black text-tm-navy">Done ({done.length})</h2>
          {list(done)}
        </section>
      )}
    </div>
  )
}
