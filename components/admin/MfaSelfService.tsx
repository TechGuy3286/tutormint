'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, ShieldOff, Copy, Check, Printer } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// Set up two-factor whenever you choose (PR49 §2 / PR50 §2) — the on-demand
// version of the sign-in gate. Reached from the admin "Two-factor" screen by
// any staff member, so an operations or admin account that never sees the Team
// page can still turn it on early and manage its backup codes.
//
// Plain words, one step at a time, works on a phone.
//   - Not on yet: explain it, scan the code, enter a number, save backup codes.
//   - Already on: show that it is on and how many backup codes are left, and let
//     them make a fresh set (which cancels the old ones).

const CODE_RE = /^\d{6}$/

export default function MfaSelfService({
  enrolled,
  backupLeft,
}: {
  enrolled: boolean
  backupLeft: number
}) {
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // enrol state
  const [enrolling, setEnrolling] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')

  // backup codes shown once
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  const startEnrol = useCallback(async () => {
    setError(null)
    setEnrolling(true)
    setQr(null)
    setSecret(null)
    setFactorId(null)
    setCode('')
    // Clear any half-finished factor so a retry does not pile them up.
    const { data: list } = await supabase.auth.mfa.listFactors()
    for (const f of list?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error: e } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `TutorMint ${Date.now()}`,
    })
    if (e || !data) {
      setError('Could not start two-factor setup. Please try again.')
      setEnrolling(false)
      return
    }
    setFactorId(data.id)
    setQr(data.totp.qr_code)
    setSecret(data.totp.secret)
  }, [supabase])

  const confirmCode = async () => {
    if (!CODE_RE.test(code)) {
      setError('Enter the 6-digit number from your app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let fid = factorId
      if (!fid) {
        const { data: list } = await supabase.auth.mfa.listFactors()
        fid = list?.totp?.[0]?.id ?? null
      }
      if (!fid) {
        setError('Something went wrong. Please start again.')
        setBusy(false)
        return
      }
      const ch = await supabase.auth.mfa.challenge({ factorId: fid })
      if (ch.error || !ch.data) {
        setError('That did not work. Please try again.')
        setBusy(false)
        return
      }
      const v = await supabase.auth.mfa.verify({ factorId: fid, challengeId: ch.data.id, code })
      if (v.error) {
        setError('That number was not right. Check your app and try again.')
        setBusy(false)
        return
      }
      // On now — hand back the one-time backup codes.
      const res = await fetch('/api/admin/mfa/backup-codes', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      setBusy(false)
      setEnrolling(false)
      if (res.ok && Array.isArray(json.codes)) {
        setBackupCodes(json.codes as string[])
        toast.success('Two-factor is on.')
      } else {
        toast.success('Two-factor is on.')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Make new backup codes?',
      body: 'Your old backup codes will stop working straight away. You will see the new ones once — save them somewhere safe.',
      confirmLabel: 'Make new codes',
      destructive: false,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/mfa/backup-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: true }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && Array.isArray(json.codes)) {
      setBackupCodes(json.codes as string[])
      toast.success('New backup codes made. The old ones no longer work.')
    } else {
      const m = (json as { error?: string }).error ?? 'Could not make new codes.'
      setError(m)
      toast.error(m)
    }
  }

  const copyCodes = async () => {
    if (!backupCodes) return
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard may be blocked */
    }
  }

  const printCodes = () => {
    if (!backupCodes) return
    const w = window.open('', '_blank', 'width=400,height=600')
    if (!w) return
    w.document.write(
      `<pre style="font:16px monospace;padding:24px;line-height:2">TutorMint backup codes\n\n${backupCodes.join('\n')}\n\nEach code works once. Keep this somewhere safe.</pre>`,
    )
    w.document.close()
    w.print()
  }

  const primary =
    'inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-sm font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50'
  const ghost =
    'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-50'
  const input =
    'w-full max-w-[220px] rounded-xl border border-gray-200 bg-white p-3 text-center text-lg tracking-widest outline-none focus:border-tm-red'

  // ── the one-time backup codes ──────────────────────────────────────────────
  if (backupCodes) {
    return (
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2 text-tm-green-deep">
          <ShieldCheck size={20} aria-hidden />
          <h2 className="text-base font-black">Save your backup codes</h2>
        </div>
        <p className="text-xs leading-relaxed text-slate-700">
          Keep these <strong>backup codes</strong> somewhere safe — not on the same phone as your
          authenticator app. If you ever lose your phone, one of these lets you sign in and set up a
          new app. Each one works once. We will not show them again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-tm-bg p-3 font-mono text-sm text-tm-navy sm:max-w-md">
          {backupCodes.map((c) => (
            <li key={c} className="text-center tracking-widest">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyCodes} className={ghost}>
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? 'Copied' : 'Copy the codes'}
          </button>
          <button type="button" onClick={printCodes} className={ghost}>
            <Printer size={14} aria-hidden /> Print
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setBackupCodes(null)
            router.refresh()
          }}
          className={primary}
        >
          I have saved them
        </button>
      </section>
    )
  }

  // ── setting up now ─────────────────────────────────────────────────────────
  if (enrolling) {
    return (
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-black text-tm-navy">Set up two-factor</h2>
        <ol className="space-y-1 text-xs leading-relaxed text-slate-700">
          <li>1. On your phone, open an authenticator app (Google Authenticator, Microsoft Authenticator).</li>
          <li>2. Scan this square, or type the code below into the app.</li>
          <li>3. Enter the 6-digit number the app shows.</li>
        </ol>
        {qr ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline data URI */}
            <img src={qr} alt="Scan this with your authenticator app" className="h-44 w-44" />
            {secret && (
              <p className="break-all rounded-lg bg-tm-bg p-2 font-mono text-[11px] text-slate-700 sm:max-w-md">
                {secret}
              </p>
            )}
          </div>
        ) : (
          <div className="grid h-44 place-items-center">
            <Loader2 className="animate-spin text-gray-500" aria-hidden />
          </div>
        )}
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          aria-label="6-digit code"
          className={input}
        />
        {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={confirmCode} disabled={busy || !qr} className={primary}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Turn on two-factor
          </button>
          <button
            type="button"
            onClick={() => {
              setEnrolling(false)
              setError(null)
            }}
            className={ghost}
          >
            Cancel
          </button>
        </div>
      </section>
    )
  }

  // ── the resting state: on, or not set up ──────────────────────────────────
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        {enrolled ? (
          <ShieldCheck size={20} className="text-tm-green-deep" aria-hidden />
        ) : (
          <ShieldOff size={20} className="text-gray-500" aria-hidden />
        )}
        <h2 className="text-base font-black text-tm-navy">
          {enrolled ? 'Two-factor is on' : 'Two-factor is not set up yet'}
        </h2>
      </div>
      <p className="text-xs leading-relaxed text-slate-700">
        Two-factor means you also type a 6-digit number from an app on your phone when you sign in.
        It keeps your account safe even if someone learns your password.
      </p>

      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      {enrolled ? (
        <>
          <p className="text-xs text-gray-500">
            You have {backupLeft} backup {backupLeft === 1 ? 'code' : 'codes'} left.
          </p>
          <button type="button" onClick={regenerate} disabled={busy} className={ghost}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Make new backup codes
          </button>
          <p className="text-[11px] leading-relaxed text-gray-500">
            Making new codes cancels your old ones. If you lost your phone <em>and</em> your backup
            codes, ask the owner to reset your two-factor.
          </p>
        </>
      ) : (
        <button type="button" onClick={startEnrol} disabled={busy} className={primary}>
          Set up two-factor
        </button>
      )}
    </section>
  )
}
