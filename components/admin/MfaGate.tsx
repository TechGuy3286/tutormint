'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, KeyRound, Copy, Check } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import AdminSignOut from '@/components/admin/AdminSignOut'

// The staff two-factor screen (PR49 §2), shown by the admin layout in place of
// the panel until the sign-in is verified. Plain words, one thing per step, on a
// phone screen.
//
//   mode="setup"  — no authenticator yet: scan the code, enter a number, save
//                   the backup codes.
//   mode="verify" — has an authenticator: enter today's number (or use a backup
//                   code if the phone is lost).

const CODE_RE = /^\d{6}$/

export default function MfaGate({ mode, email }: { mode: 'setup' | 'verify'; email: string | null }) {
  const router = useRouter()
  const supabase = createClient()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

  // setup state
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  // verify state
  const [useBackup, setUseBackup] = useState(false)
  const [backup, setBackup] = useState('')
  const enrolStarted = useRef(false)

  // ── setup: start a fresh TOTP enrolment ───────────────────────────────────
  const startEnrol = useCallback(async () => {
    setError(null)
    // Clear any half-finished factor so a reload does not pile them up.
    const { data: list } = await supabase.auth.mfa.listFactors()
    for (const f of list?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error: e } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `TutorMint ${Date.now()}`,
    })
    if (e || !data) {
      setError('Could not start two-factor setup. Please try again, or contact the owner.')
      return
    }
    setFactorId(data.id)
    setQr(data.totp.qr_code)
    setSecret(data.totp.secret)
  }, [supabase])

  useEffect(() => {
    if (mode === 'setup' && !enrolStarted.current) {
      enrolStarted.current = true
      void startEnrol()
    }
  }, [mode, startEnrol])

  // ── verify a 6-digit code (both modes) ────────────────────────────────────
  const submitCode = async () => {
    if (!CODE_RE.test(code)) {
      setError('Enter the 6-digit number from your app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The factor id: the one we just enrolled, or the verified one on file.
      let fid = factorId
      if (!fid) {
        const { data: list } = await supabase.auth.mfa.listFactors()
        fid = list?.totp?.[0]?.id ?? null
      }
      if (!fid) {
        setError('No authenticator is set up. Please refresh and start again.')
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
      // Setup: the account is now protected — hand back the one-time backup codes.
      if (mode === 'setup') {
        const res = await fetch('/api/admin/mfa/backup-codes', { method: 'POST' })
        const json = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(json.codes)) {
          setBackupCodes(json.codes as string[])
          setBusy(false)
          return // show the codes; the panel opens when they press Continue
        }
      }
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  // ── verify: lost the phone, use a one-time backup code ────────────────────
  const submitBackup = async () => {
    if (backup.trim().length < 4) {
      setError('Enter one of your backup codes.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/mfa/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: backup }),
    })
    if (res.ok) {
      // The old authenticator is gone; set up a new one now.
      router.refresh()
      return
    }
    const json = await res.json().catch(() => ({}))
    setError(json.error ?? 'That backup code was not right.')
    setBusy(false)
  }

  const copyCodes = async () => {
    if (!backupCodes) return
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard may be blocked */ }
  }

  const card = 'w-full max-w-sm space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'
  const input =
    'w-full rounded-xl border border-gray-200 bg-white p-3 text-center text-lg tracking-widest outline-none focus:border-tm-red'
  const primary =
    'inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-sm font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50'

  return (
    <main className="grid min-h-screen place-items-center bg-tm-bg px-4 py-8">
      <div className={card}>
        <div className="flex items-center gap-2 text-tm-navy">
          <ShieldCheck size={20} aria-hidden />
          <h1 className="text-base font-black">Protect your staff account</h1>
        </div>
        {email && <p className="text-[11px] text-gray-500">Signed in as {email}</p>}

        {/* ── the one-time backup codes, shown after setup ── */}
        {backupCodes ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-700">
              Save these <strong>backup codes</strong> somewhere safe. If you ever lose your phone,
              one of these lets you sign in and set up a new app. Each one works once. We will not
              show them again.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-tm-bg p-3 font-mono text-sm text-tm-navy">
              {backupCodes.map((c) => (
                <li key={c} className="text-center tracking-widest">{c}</li>
              ))}
            </ul>
            <button type="button" onClick={copyCodes} className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-navy">
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? 'Copied' : 'Copy the codes'}
            </button>
            <button type="button" onClick={() => router.refresh()} className={primary}>
              I have saved them — open the panel
            </button>
          </div>
        ) : mode === 'setup' ? (
          <div className="space-y-3">
            <ol className="space-y-1 text-xs leading-relaxed text-slate-700">
              <li>1. On your phone, open an authenticator app (Google Authenticator, Microsoft Authenticator).</li>
              <li>2. Scan this square, or type the code below into the app.</li>
              <li>3. Enter the 6-digit number the app shows.</li>
            </ol>
            {qr ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline data URI */}
                <img src={qr} alt="Scan this with your authenticator app" className="mx-auto h-44 w-44" />
                {secret && (
                  <p className="break-all rounded-lg bg-tm-bg p-2 text-center font-mono text-[11px] text-slate-700">
                    {secret}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid h-44 place-items-center"><Loader2 className="animate-spin text-gray-500" aria-hidden /></div>
            )}
            <input
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000" aria-label="6-digit code" className={input}
            />
            {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
            <button type="button" onClick={submitCode} disabled={busy} className={primary}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Turn on two-factor
            </button>
          </div>
        ) : useBackup ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-700">
              Enter one of your <strong>backup codes</strong>. It works once and then you will set up
              your app again.
            </p>
            <input
              value={backup} onChange={(e) => setBackup(e.target.value)} maxLength={12}
              placeholder="XXXX-XXXX" aria-label="Backup code"
              className="w-full rounded-xl border border-gray-200 bg-white p-3 text-center text-base tracking-widest uppercase outline-none focus:border-tm-red"
            />
            {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
            <button type="button" onClick={submitBackup} disabled={busy} className={primary}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Use this backup code
            </button>
            <button type="button" onClick={() => { setUseBackup(false); setError(null) }} className="text-xs font-bold text-tm-navy">
              ← Back to entering a number
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-700">
              Open your authenticator app and enter the 6-digit number it shows for TutorMint.
            </p>
            <input
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000" aria-label="6-digit code" className={input}
            />
            {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
            <button type="button" onClick={submitCode} disabled={busy} className={primary}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Sign in
            </button>
            <button type="button" onClick={() => { setUseBackup(true); setError(null) }} className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-navy">
              <KeyRound size={13} aria-hidden /> Lost your phone? Use a backup code
            </button>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 text-center">
          <AdminSignOut tone="light" />
        </div>
      </div>
    </main>
  )
}
