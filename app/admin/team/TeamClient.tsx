'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, KeyRound, Mail, ShieldAlert } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'

// The Team screen.
//
// Mobile-first: staff are cards, not a table, at every width — there are never
// many of them and each row carries a role selector and two actions, which a
// table would squash.
//
// The one-time password is the part worth being careful with. When Supabase has
// no SMTP the server creates the account directly and returns a temporary
// password; it is shown here ONCE, never stored, and never written to the audit
// log. Reloading the page loses it, and the panel says so plainly rather than
// letting the owner assume they can come back for it.

export type StaffRow = {
  id: string
  name: string
  email: string
  adminRole: 'owner' | 'manager' | 'verifier' | 'finance' | 'support'
  suspended: boolean
  suspensionReason: string | null
  mustChangePassword: boolean
  createdAt: string
  isMe: boolean
}

const ROLES = [
  { code: 'manager', label: 'Manager', blurb: 'Everything except this screen' },
  { code: 'verifier', label: 'Verifier', blurb: 'Tutor and parent verification queues' },
  { code: 'finance', label: 'Finance', blurb: 'Payments, subscriptions, quota usage' },
  { code: 'support', label: 'Support', blurb: 'Reports, blocks, penalties, members' },
] as const

export default function TeamClient({ staff }: { staff: StaffRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', adminRole: 'support' })
  const [newAccount, setNewAccount] = useState<{
    email: string
    invited: boolean
    temporaryPassword: string | null
  } | null>(null)
  const [suspendingId, setSuspendingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const call = async (payload: Record<string, unknown>, id: string) => {
    setBusy(id)
    setError(null)
    try {
      const { ok, data: json } = await adminFetch<{ error?: string; invited?: boolean; temporaryPassword?: string | null }>(
        '/api/admin/team',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        },
      )
      if (!ok) throw new Error(json.error ?? 'That did not work.')
      router.refresh()
      return json
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const json = await call({ action: 'create', ...form }, 'new')
    if (!json) return
    setNewAccount({
      email: form.email,
      invited: !!json.invited,
      temporaryPassword: json.temporaryPassword ?? null,
    })
    setCreating(false)
    setForm({ fullName: '', email: '', adminRole: 'support' })
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Team</h1>
        <p className="text-xs text-gray-500">
          There is exactly one owner and it cannot be changed here. Every other role can be granted,
          changed and revoked.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {/* ------------------------------------------- one-time credentials --- */}
      {newAccount && (
        <section className="space-y-2 rounded-2xl border-2 border-tm-green-deep bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-black text-tm-green-deep">
            {newAccount.invited ? <Mail size={16} /> : <KeyRound size={16} />}
            {newAccount.invited ? 'Invite sent' : 'Account created'}
          </p>
          {newAccount.invited ? (
            <p className="text-xs leading-relaxed text-slate-700">
              An invitation email is on its way to <strong>{newAccount.email}</strong>. They set
              their own password from the link.
            </p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-slate-700">
                No invitation email could be sent, so the account was created with a temporary
                password. Pass it to <strong>{newAccount.email}</strong> yourself — it is shown
                once, is not stored anywhere, and stops working after their first sign-in.
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-tm-bg p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-xs font-bold text-tm-navy">
                  {newAccount.temporaryPassword}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(newAccount.temporaryPassword ?? '')
                  }
                  aria-label="Copy temporary password"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-200"
                >
                  <Copy size={14} />
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setNewAccount(null)}
            className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
          >
            Done
          </button>
        </section>
      )}

      {/* -------------------------------------------------- add a member --- */}
      {creating ? (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">Add a staff member</h2>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-gray-500">Full name</span>
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-gray-500">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold text-gray-500">Role</legend>
            {ROLES.map((r) => (
              <label
                key={r.code}
                className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-xl border p-3 ${
                  form.adminRole === r.code ? 'border-tm-navy bg-tm-bg' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="adminRole"
                  value={r.code}
                  checked={form.adminRole === r.code}
                  onChange={() => setForm({ ...form, adminRole: r.code })}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-black text-tm-navy">{r.label}</span>
                  <span className="block text-[11px] text-gray-500">{r.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy === 'new' || form.email.trim().length < 5 || form.fullName.trim().length < 2}
              className="min-h-[44px] rounded-xl bg-tm-black px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              {busy === 'new' ? 'Creating…' : 'Create account'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 text-xs font-bold text-white sm:w-auto sm:px-6"
        >
          Add a staff member
        </button>
      )}

      {/* -------------------------------------------------------- roster --- */}
      <ul className="space-y-3">
        {staff.map((s) => (
          <li
            key={s.id}
            className={`space-y-3 rounded-2xl border bg-white p-4 ${
              s.suspended ? 'border-tm-gold/30' : 'border-gray-200'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-tm-navy">
                  {s.name}
                  {s.isMe && <span className="ml-2 text-[10px] font-bold text-gray-400">you</span>}
                </p>
                <p className="truncate text-[11px] text-gray-500">{s.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {s.mustChangePassword && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    not signed in yet
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    s.suspended
                      ? 'bg-tm-tint-gold text-tm-gold-ink'
                      : s.adminRole === 'owner'
                        ? 'bg-tm-black text-white'
                        : 'bg-tm-tint-green text-tm-green-deep'
                  }`}
                >
                  {s.suspended ? 'suspended' : s.adminRole}
                </span>
              </div>
            </div>

            {s.suspended && s.suspensionReason && (
              <p className="rounded-xl bg-tm-tint-gold p-2 text-[11px] text-tm-gold-ink">
                {s.suspensionReason}
              </p>
            )}

            {s.adminRole === 'owner' ? (
              <p className="flex items-start gap-2 rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
                <ShieldAlert size={14} className="mt-px shrink-0" />
                The owner cannot be demoted or suspended, including by themselves. Transferring
                ownership is a database operation, on purpose.
              </p>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-gray-500">Role</span>
                  <select
                    value={s.adminRole}
                    disabled={busy === s.id}
                    onChange={(e) => call({ action: 'role', userId: s.id, adminRole: e.target.value }, s.id)}
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                  >
                    {ROLES.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label} — {r.blurb}
                      </option>
                    ))}
                  </select>
                </label>

                {suspendingId === s.id ? (
                  <div className="space-y-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for the record"
                      aria-label="Reason"
                      className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={reason.trim().length < 5 || busy === s.id}
                        onClick={async () => {
                          await call({ action: 'suspend', userId: s.id, reason }, s.id)
                          setSuspendingId(null)
                          setReason('')
                        }}
                        className="min-h-[44px] rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
                      >
                        Suspend access
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSuspendingId(null)
                          setReason('')
                        }}
                        className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : s.suspended ? (
                  <button
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => call({ action: 'reactivate', userId: s.id }, s.id)}
                    className="min-h-[44px] w-full rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white"
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={s.isMe}
                    onClick={() => setSuspendingId(s.id)}
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-40"
                  >
                    {s.isMe ? 'You cannot suspend yourself' : 'Suspend access'}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
