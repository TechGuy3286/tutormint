import { notFound } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { formatName } from '@/lib/formatName'
import { loadJourney } from '@/lib/journey'
import { JOURNEY_KIND_LABEL } from '@/lib/journeyCore'
import MemberTabs from '@/components/admin/MemberTabs'
import { LogNoteButton, WithdrawNoteButton } from './ActivityClient'

// A member's Activity tab (owner, 23 Oct 2026; rules lib/journeyCore, reads
// lib/journey). One timeline, newest first, each line with its time and who
// did it; lines rebuilt from records made before the tab existed say "from
// records". A summary strip on top. No phone, CNIC number or email anywhere on
// this page. Open to every role that works tutors (SCREEN_ACCESS.memberActivity)
// — Tuitions staff reach it from Tuitions → Paid tutors.

export const dynamic = 'force-dynamic'

const KIND_TONE: Partial<Record<string, string>> = {
  paid: 'bg-tm-tint-green text-tm-green-deep',
  hired: 'bg-tm-tint-green text-tm-green-deep',
  doc_approved: 'bg-tm-tint-green text-tm-green-deep',
  doc_rejected: 'bg-tm-tint-red text-tm-red',
  payment_failed: 'bg-tm-tint-red text-tm-red',
  follow_up: 'bg-tm-tint-navy text-tm-navy',
  forwarded: 'bg-tm-tint-navy text-tm-navy',
  note: 'bg-tm-tint-gold text-tm-gold-ink',
  call: 'bg-tm-tint-gold text-tm-gold-ink',
  account_type: 'bg-tm-tint-gold text-tm-gold-ink',
}

export default async function MemberActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.memberActivity)
  const { id } = await params
  const admin = createAdminClient()
  if (!admin) return <p className="text-xs font-bold text-tm-red">This is not working right now.</p>
  const { data: profile } = await admin.from('profiles').select('id, full_name, role, city').eq('id', id).maybeSingle()
  if (!profile) notFound()
  const journey = await loadJourney(id)
  if (!journey) notFound()
  const name = formatName(profile.full_name as string | null) || 'Member'
  const roleWord = journey.role === 'tutor' ? 'Tutor' : journey.role === 'parent' ? 'Parent' : 'Member'

  const strip: { label: string; value: string }[] =
    journey.role === 'tutor' && journey.counts
      ? [
          { label: 'Paid', value: journey.paidAt ? formatDate(journey.paidAt) : 'Not paid' },
          { label: 'Applications', value: String(journey.counts.applications) },
          { label: 'Forwarded', value: String(journey.counts.forwarded) },
          { label: 'Waiting to forward', value: String(journey.counts.waitingToForward) },
          { label: 'Hired', value: String(journey.counts.hired) },
          { label: 'Last contact', value: journey.lastContactAt ? formatDate(journey.lastContactAt) : 'Never' },
        ]
      : [
          { label: 'Tuitions posted', value: String(journey.tuitions) },
          { label: 'Last contact', value: journey.lastContactAt ? formatDate(journey.lastContactAt) : 'Never' },
        ]

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-black text-tm-navy">{name}</h2>
        <p className="text-xs text-gray-600">
          {roleWord}
          {profile.city ? ` · ${profile.city}` : ''}
        </p>
      </header>
      <MemberTabs memberId={id} current="activity" showProfile={roleSatisfies(actor.adminRole, SCREEN_ACCESS.users)} />

      <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {strip.map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{s.label}</p>
            <p className="text-sm font-black text-tm-navy">{s.value}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-start gap-2">
        <LogNoteButton memberId={id} />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-xs font-black uppercase tracking-wide text-gray-500">Activity ({journey.lines.length})</h3>
        {journey.lines.length === 0 ? (
          <p className="pt-2 text-xs text-gray-500">Nothing yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-gray-100">
            {journey.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                <time dateTime={l.at} className="w-[150px] shrink-0 text-[11px] font-semibold text-gray-600">
                  {formatDateTime(l.at)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs ${l.withdrawn ? 'text-gray-500 line-through' : 'font-semibold text-slate-800'}`}>
                    <span className={`me-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${KIND_TONE[l.kind] ?? 'bg-gray-100 text-slate-700'}`}>{JOURNEY_KIND_LABEL[l.kind]}</span>
                    {l.text}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {l.by ? `by ${l.by}` : 'by the system'}
                    {l.fromRecords && <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">from records</span>}
                  </p>
                  {l.withdrawn && (
                    <p className="text-[11px] font-semibold text-tm-gold-ink">
                      Withdrawn {formatDate(l.withdrawn.at)}
                      {l.withdrawn.by ? ` by ${l.withdrawn.by}` : ''}: {l.withdrawn.reason}
                    </p>
                  )}
                  {l.noteId && !l.withdrawn && <WithdrawNoteButton noteId={l.noteId} />}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
