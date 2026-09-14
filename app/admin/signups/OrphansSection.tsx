'use client'

import { useState } from 'react'
import { AlertTriangle, UserCheck } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import type { OrphanAccount } from '@/lib/adminOrphans'

// Orphaned accounts — auth.users rows with no profiles row (owner, 14 Sep 2026,
// folded in here from its own screen). A DIFFERENT failure from an abandoned
// signup: an abandoned signup never became an account; an orphan IS an account
// the app has no record of, so the person can sign in to a shell. The failure
// mode from the Sydney→Mumbai migration when on_auth_user_created was dropped.
//
// "Create missing profile" inserts the profiles row (and tutor_profiles for a
// tutor) from the auth user's own metadata, server-side, audit-logged. A role
// is never invented — a roleless orphan is refused with a message.

export default function OrphansSection({
  rows,
  ok,
}: {
  rows: OrphanAccount[]
  ok: boolean
}) {
  const { success, error } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  async function create(row: OrphanAccount) {
    setBusy(row.id)
    try {
      const res = await fetch('/api/admin/orphans/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: row.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        error(data.error ?? 'Could not create the profile.')
        return
      }
      setDone((prev) => new Set(prev).add(row.id))
      success('Profile created from the account’s signup details.')
    } catch {
      error('Could not create the profile. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h2 className="text-lg font-black text-tm-navy">Orphaned accounts</h2>
        <p className="text-xs text-gray-500">
          Sign-ins that exist in auth but have no profile — the app has no record of them. Different
          from an abandoned signup, which never became an account. Create the missing profile from
          the account’s own signup details.
        </p>
      </div>

      {!ok && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          Could not enumerate auth users (SUPABASE_SERVICE_ROLE_KEY missing, or the Auth API refused).
          The list may be incomplete.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-6 text-center text-xs font-bold text-tm-green-deep">
          No orphaned accounts. Every auth user has a profile.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3 text-[11px] font-semibold text-slate-700">
            <AlertTriangle aria-hidden size={14} className="shrink-0 text-tm-gold-ink" />
            {rows.length} account{rows.length === 1 ? '' : 's'} with no profile. Creating one is
            audit-logged; a roleless signup is refused rather than guessed.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Email / mobile</th>
                  <th className="p-3 font-bold">Signup role</th>
                  <th className="p-3 font-bold">Name</th>
                  <th className="p-3 font-bold">Signed up</th>
                  <th className="p-3 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const roleless = r.metaRole === '(none)' || r.metaRole === 'admin'
                  return (
                    <tr key={r.id} className="align-middle">
                      <td className="p-3">
                        <span className="block font-semibold text-tm-navy">{r.email ?? '—'}</span>
                        {r.mobile && <span className="block text-gray-500">{r.mobile}</span>}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            r.metaRole === '(none)'
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-tm-tint-navy text-tm-navy'
                          }`}
                        >
                          {r.metaRole}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700">{r.fullName ?? '—'}</td>
                      <td className="p-3 text-gray-500">{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                      <td className="p-3 text-right">
                        {done.has(r.id) ? (
                          <span className="text-[10px] font-bold text-tm-green-deep">Profile created</span>
                        ) : roleless ? (
                          <span className="text-[10px] font-semibold text-gray-500">
                            {r.metaRole === 'admin' ? 'Use the Team screen' : 'No role — backfill manually'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => create(r)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-tm-navy px-3 py-1.5 text-[11px] font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
                          >
                            <UserCheck aria-hidden size={12} />
                            {busy === r.id ? 'Creating…' : 'Create missing profile'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
