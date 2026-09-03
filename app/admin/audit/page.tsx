import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditPage } from '@/lib/auditFeed'
import AuditEntry from './AuditEntry'
import MoreEntries from './MoreEntries'

// The admin audit trail. owner / manager. Read-only, and read-only by
// construction: admin_audit_log has a SELECT policy and nothing else, so there
// is no UPDATE or DELETE path even with the anon key. Entries are written only
// through lib/auditLog.ts with the service role.
//
// actor_email is stored on the row rather than joined, so an entry still says
// who did something after that staff account is deleted. This screen shows the
// stored value for exactly that reason.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; page?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.audit)
  const { action = 'all', actor = '', page = '1' } = await searchParams
  const pageNum = Math.max(1, Number(page) || 1)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  // The first window server-side, the rest appended from a keyset cursor.
  const { entries, nextCursor } = await auditPage({
    filters: { action, actor },
    limit: PAGE_SIZE,
    offset: (pageNum - 1) * PAGE_SIZE,
  })

  // Which action families actually exist, so the chips reflect reality rather
  // than a hardcoded list that drifts.
  const { data: allActions } = await admin.from('admin_audit_log').select('action').limit(2000)
  const families = Array.from(
    new Set((allActions ?? []).map((a) => (a.action as string).split('.')[0])),
  ).sort()

  const chipHref = (a: string) => {
    const p = new URLSearchParams()
    if (a !== 'all') p.set('action', a)
    if (actor.trim()) p.set('actor', actor.trim())
    return `/admin/audit${p.toString() ? `?${p}` : ''}`
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Audit</h1>
        <p className="text-xs text-gray-500">
          Every admin mutation, append-only. Nothing on this page can change a row.
        </p>
      </header>

      <form method="GET" action="/admin/audit" className="flex flex-col gap-2 sm:flex-row">
        <input
          name="actor"
          defaultValue={actor}
          placeholder="Filter by admin email"
          aria-label="Filter by admin email"
          className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
        />
        {action !== 'all' && <input type="hidden" name="action" value={action} />}
        <button
          type="submit"
          className="min-h-[44px] rounded-xl bg-tm-black px-6 text-xs font-bold text-white"
        >
          Filter
        </button>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label="Action type">
        {['all', ...families].map((f) => (
          <Link
            key={f}
            href={chipHref(f)}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold capitalize ${
              action === f
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {f}
          </Link>
        ))}
      </nav>

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nothing matches that.
        </p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <AuditEntry key={e.id} entry={e} />
          ))}
        </ol>
      )}

      {/* No Newer/Older paging (CLAUDE.md, 3 Sep 2026). */}
      {entries.length > 0 && (
        <MoreEntries
          params={{
            ...(action !== 'all' ? { action } : {}),
            ...(actor.trim() ? { actor: actor.trim() } : {}),
          }}
          initialCursor={nextCursor}
          serverCount={(pageNum - 1) * PAGE_SIZE + entries.length}
        />
      )}
    </div>
  )
}
