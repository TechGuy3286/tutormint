import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'

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
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  let query = admin
    .from('admin_audit_log')
    .select('id, actor_id, actor_role, actor_email, action, target_type, target_id, detail, created_at')
    .order('created_at', { ascending: false })
    .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1)

  // Prefix filter: 'tutor' matches tutor.approve, tutor.suspend and so on, so
  // the chips stay meaningful as new actions are added.
  if (action !== 'all') query = query.like('action', `${action}.%`)
  if (actor.trim()) query = query.ilike('actor_email', `%${actor.trim()}%`)

  const { data: entries } = await query

  // Which action families actually exist, so the chips reflect reality rather
  // than a hardcoded list that drifts.
  const { data: allActions } = await admin.from('admin_audit_log').select('action').limit(2000)
  const families = Array.from(
    new Set((allActions ?? []).map((a) => (a.action as string).split('.')[0])),
  ).sort()

  const targetIds = Array.from(
    new Set((entries ?? []).map((e) => e.target_id as string).filter(Boolean)),
  ).filter((v) => /^[0-9a-f-]{36}$/i.test(v))

  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', targetIds.length ? targetIds : ['00000000-0000-0000-0000-000000000000'])

  const nameById = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]))

  const chipHref = (a: string) => {
    const p = new URLSearchParams()
    if (a !== 'all') p.set('action', a)
    if (actor.trim()) p.set('actor', actor.trim())
    return `/admin/audit${p.toString() ? `?${p}` : ''}`
  }

  const pageHref = (n: number) => {
    const p = new URLSearchParams()
    if (action !== 'all') p.set('action', action)
    if (actor.trim()) p.set('actor', actor.trim())
    if (n > 1) p.set('page', String(n))
    return `/admin/audit${p.toString() ? `?${p}` : ''}`
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Audit</h1>
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
          className="min-h-[44px] rounded-xl bg-[#0F172A] px-6 text-xs font-bold text-white"
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
                ? 'bg-[#0F172A] text-white'
                : 'border border-gray-200 bg-white text-[#334155]'
            }`}
          >
            {f}
          </Link>
        ))}
      </nav>

      {(entries ?? []).length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          Nothing matches that.
        </p>
      ) : (
        <ol className="space-y-2">
          {(entries ?? []).map((e) => (
            <li key={e.id as string} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-600">
                  {e.action as string}
                </span>
                {/* The role is the "with what authority" half of the entry, so
                    it must not be the part that gets truncated. At 360px a long
                    address used to eat it entirely: the email truncates inside
                    its own span, the role never shrinks. */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1">
                  <span className="min-w-0 truncate text-xs font-semibold text-[#0F172A]">
                    {(e.actor_email as string) ?? 'system'}
                  </span>
                  <span className="shrink-0 text-xs font-normal text-gray-400">
                    ({(e.actor_role as string) ?? '—'})
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {new Date(e.created_at as string).toLocaleString('en-PK')}
                </span>
              </div>

              <p className="text-[11px] text-gray-500">
                {(e.target_type as string) ?? 'target'}:{' '}
                {e.target_id && nameById.has(e.target_id as string) ? (
                  <Link
                    href={`/admin/users/${e.target_id}`}
                    className="font-bold text-[#0F172A] hover:underline"
                  >
                    {nameById.get(e.target_id as string)}
                  </Link>
                ) : (
                  <span className="font-mono">{(e.target_id as string) ?? '—'}</span>
                )}
              </p>

              {Object.keys((e.detail as Record<string, unknown>) ?? {}).length > 0 && (
                <p className="break-words text-[11px] leading-relaxed text-gray-500">
                  {Object.entries(e.detail as Record<string, unknown>)
                    .filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between gap-2">
        {pageNum > 1 ? (
          <Link
            href={pageHref(pageNum - 1)}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#334155]"
          >
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {(entries ?? []).length === PAGE_SIZE && (
          <Link
            href={pageHref(pageNum + 1)}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#334155]"
          >
            Older →
          </Link>
        )}
      </div>
    </div>
  )
}
