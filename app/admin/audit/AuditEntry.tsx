import Link from 'next/link'

// One audit row, rendered the same whether the server drew it or the browser
// appended it. Extracted for that reason: a second copy of this markup would be
// a second place for "who did it, with what authority" to drift.

export type AuditRow = {
  id: string
  actor_email: string | null
  actor_role: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
  /** Resolved server-side; the browser is never given a way to look people up. */
  target_name?: string | null
}

export default function AuditEntry({ entry }: { entry: AuditRow }) {
  const detail = entry.detail ?? {}

  return (
    <li className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-600">
          {entry.action}
        </span>
        {/* The role is the "with what authority" half of the entry, so it must
            not be the part that gets truncated. At 360px a long address used to
            eat it entirely: the email truncates inside its own span, the role
            never shrinks. */}
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <span className="min-w-0 truncate text-xs font-semibold text-tm-navy">
            {entry.actor_email ?? 'system'}
          </span>
          <span className="shrink-0 text-xs font-normal text-gray-500">
            ({entry.actor_role ?? '—'})
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-gray-500">
          {new Date(entry.created_at).toLocaleString('en-PK')}
        </span>
      </div>

      <p className="text-[11px] text-gray-500">
        {entry.target_type ?? 'target'}:{' '}
        {entry.target_id && entry.target_name ? (
          <Link
            href={`/admin/users/${entry.target_id}`}
            className="font-bold text-tm-navy hover:underline"
          >
            {entry.target_name}
          </Link>
        ) : (
          <span className="font-mono">{entry.target_id ?? '—'}</span>
        )}
      </p>

      {Object.keys(detail).length > 0 && (
        <p className="break-words text-[11px] leading-relaxed text-gray-500">
          {Object.entries(detail)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' · ')}
        </p>
      )}
    </li>
  )
}
