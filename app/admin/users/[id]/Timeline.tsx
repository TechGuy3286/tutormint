import Link from 'next/link'

// The member activity timeline.
//
// A server component: it renders what the page already fetched, and the filter
// is a link rather than client state, so a filtered timeline is a URL an admin
// can share.
//
// PRIVACY, restated where it is enforced: a message event carries a thread id
// and nothing else. `meta` is rendered as compact key/value pairs, and the
// logging helper (lib/activityLog.ts) never puts a message body in it -- so
// there is no body here to leak even if this component wanted one.

export type TimelineEvent = {
  id: string
  event: string
  label: string
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown>
  at: string
}

const GROUPS = [
  { key: 'all', label: 'Everything' },
  { key: 'account', label: 'Account' },
  { key: 'activity', label: 'Activity' },
  { key: 'money', label: 'Money' },
  { key: 'moderation', label: 'Moderation' },
]

const TONE: Record<string, string> = {
  suspended: 'bg-red-100 text-red-700',
  warned: 'bg-amber-100 text-amber-700',
  unsuspended: 'bg-emerald-100 text-emerald-700',
  plan_purchased: 'bg-emerald-100 text-emerald-700',
  plan_expired: 'bg-gray-100 text-gray-500',
  reported_by: 'bg-amber-100 text-amber-700',
}

export default function Timeline({
  events,
  memberId,
  group,
}: {
  events: TimelineEvent[]
  memberId: string
  group: string
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black text-[#0F172A]">Timeline</h2>
        <p className="text-[11px] text-gray-400">
          {events.length} event{events.length === 1 ? '' : 's'}, newest first
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Timeline filter">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={`/admin/users/${memberId}${g.key === 'all' ? '' : `?group=${g.key}`}`}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              group === g.key
                ? 'bg-[#0F172A] text-white'
                : 'border border-gray-200 bg-white text-[#334155]'
            }`}
          >
            {g.label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          Nothing recorded in this group.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl border border-gray-200 bg-white p-3"
            >
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                  TONE[e.event] ?? 'bg-slate-100 text-slate-500'
                }`}
              >
                {e.event.replace(/_/g, ' ')}
              </span>
              <span className="min-w-0 flex-1 text-xs font-semibold text-[#0F172A]">{e.label}</span>
              <span className="shrink-0 text-[11px] text-gray-400">
                {new Date(e.at).toLocaleString('en-PK')}
              </span>
              {Object.keys(e.meta).length > 0 && (
                <p className="w-full break-words text-[11px] leading-relaxed text-gray-500">
                  {Object.entries(e.meta)
                    .filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
