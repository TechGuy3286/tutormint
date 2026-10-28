import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS, seesAllStaffLists } from '@/lib/adminAuth'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'
import { formatDate } from '@/lib/datetime'
import { loadPaidTutors } from '@/lib/paidTutors'
import {
  filterCounts,
  matchesPaidFilter,
  matchesSearch,
  matchesStaff,
  PAID_FILTER_LABEL,
  PAID_FILTERS,
  parsePaidFilter,
  RED_LABEL,
  type PaidFilter,
} from '@/lib/paidTutorsCore'
import QueueSearch from '@/components/admin/QueueSearch'
import SendStatusImageButton from '@/components/admin/SendStatusImageButton'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadImageProfileFacts } from '@/lib/social/imageVersion'
import { imageVersionKey, STATUS_DRAW } from '@/lib/social/imageVersionCore'

// Tuitions → Paid tutors (owner, 23 Oct 2026; rules lib/paidTutorsCore, reads
// lib/paidTutors). One row per paid tutor: applied, forwarded, waiting to
// forward, hired, last contact and the city owner. Red rows first. A row opens
// that tutor's Activity tab. No phone, CNIC or email on this page.

export const dynamic = 'force-dynamic'

type SP = { staff?: string; show?: string; q?: string; n?: string }

export default async function PaidTutorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.paidTutors)
  const sp = await searchParams
  const show = parsePaidFilter(sp.show)
  const staff = sp.staff ?? (seesAllStaffLists(actor.adminRole) ? 'all' : actor.id)
  const q = (sp.q ?? '').trim()
  const { rows: all, staff: owners } = await loadPaidTutors()
  const scoped = all.filter((r) => matchesStaff(r, staff) && matchesSearch(r, q))
  const counts = filterCounts(scoped)
  const filtered = scoped.filter((r) => matchesPaidFilter(r, show))
  // 25 at a time (owner, 28 Oct 2026): counts above are over the whole list.
  const page = pageSlice(filtered, shownCount(sp.n))
  const rows = page.rows
  const redWait = scoped.filter((r) => r.red.includes('waiting_to_forward')).length
  const redContact = scoped.filter((r) => r.red.includes('no_contact')).length
  // "Send status image" (owner, 26 Oct 2026): only for a tutor with the
  // Verified badge; the key makes the image URL follow the live profile.
  const svc = createAdminClient()
  const imageFacts = svc ? await loadImageProfileFacts(svc, rows.map((r) => r.id)) : new Map()
  const statusKey = (id: string): string | null => {
    const f = imageFacts.get(id)
    return f?.verified ? imageVersionKey(f, STATUS_DRAW) : null
  }

  const href = (o: { staff?: string; show?: PaidFilter }) => {
    const p = new URLSearchParams()
    const st = o.staff ?? staff
    const sh = o.show ?? show
    if (st) p.set('staff', st)
    if (sh !== 'all') p.set('show', sh)
    if (q) p.set('q', q)
    const s = p.toString()
    return s ? `/admin/paid-tutors?${s}` : '/admin/paid-tutors'
  }
  const pill = (on: boolean) =>
    `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
      on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
    }`

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Paid tutors</h2>
        <p className="text-xs text-gray-500">
          Every tutor who paid the Verification Fee, and whether we have served them. A row is red when an application has waited more than 1
          day to be forwarded, or the tutor has not been contacted for 7 days. Tap a tutor to open their Activity.
        </p>
        <p className="text-xs font-bold text-slate-800">
          {scoped.length} paid {scoped.length === 1 ? 'tutor' : 'tutors'} · <span className="text-tm-red">{counts.red} red</span> ({redWait} waiting to
          forward, {redContact} not contacted for 7 days)
        </p>
      </header>

      <form method="get" action="/admin/paid-tutors" className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block font-bold text-gray-600">Staff (city owner)</span>
          <select name="staff" defaultValue={staff} className="min-h-[40px] rounded-xl border border-gray-200 bg-white px-3 text-xs">
            <option value="all">Everyone</option>
            {owners.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === actor.id ? `${s.name} (you)` : s.name}
              </option>
            ))}
          </select>
        </label>
        {show !== 'all' && <input type="hidden" name="show" value={show} />}
        {q && <input type="hidden" name="q" value={q} />}
        <button type="submit" className="min-h-[40px] rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy">
          Apply
        </button>
      </form>

      <QueueSearch basePath="/admin/paid-tutors" initialQuery={q} filter="" keep={{ staff, show: show === 'all' ? undefined : show }} placeholder="Search by name or city" ariaLabel="Search paid tutors" />

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {PAID_FILTERS.map((f) => (
          <Link key={f} href={href({ show: f })} aria-current={f === show ? 'page' : undefined} className={pill(f === show)}>
            {PAID_FILTER_LABEL[f]} <span className={f === show ? 'text-white' : 'text-gray-500'}>{counts[f]}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">Nobody here right now.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const owner = owners.find((s) => s.id === r.ownerId)?.name ?? 'No owner'
            const red = r.red.length > 0
            return (
              <li key={r.id}>
                <Link
                  href={`/admin/users/${r.id}/activity`}
                  className={`block rounded-2xl border p-3 hover:border-tm-navy ${red ? 'border-tm-red/40 bg-tm-tint-red' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-tm-navy">{r.name}</p>
                      <p className="text-[11px] text-gray-600">
                        {r.city ?? 'No city'} · paid {formatDate(r.paidAt)} · owner: {owner}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.red.map((x) => (
                        <span key={x} className="rounded-full bg-tm-red px-2 py-0.5 text-[10px] font-bold text-white">
                          {RED_LABEL[x]}
                        </span>
                      ))}
                      {!r.profileFinished && <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">Profile not finished</span>}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
                    {[
                      ['Applied', r.counts.applied],
                      ['Forwarded', r.counts.forwarded],
                      ['Waiting to forward', r.counts.waitingToForward],
                      ['Hired', r.counts.hired],
                    ].map(([label, n]) => (
                      <div key={label as string} className="rounded-lg bg-white/70 px-2 py-1">
                        <dt className="text-[10px] font-bold text-gray-600">{label}</dt>
                        <dd className="text-sm font-black text-tm-navy">{n}</dd>
                      </div>
                    ))}
                    <div className="rounded-lg bg-white/70 px-2 py-1">
                      <dt className="text-[10px] font-bold text-gray-600">Last contact</dt>
                      <dd className="text-xs font-black text-tm-navy">{r.lastContactAt ? formatDate(r.lastContactAt) : 'Never'}</dd>
                    </div>
                  </dl>
                </Link>
                {statusKey(r.id) && (
                  <div className="mt-1 flex justify-end px-1">
                    <SendStatusImageButton memberId={r.id} name={r.name} imageKey={statusKey(r.id)!} compact />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {page.total > 0 && <LoadMoreLink shown={page.shown} total={page.total} noun="tutors" />}
    </div>
  )
}
