// The Finance settings view (owner, 26 Oct 2026) — plain markup, no data
// loading and no hooks, so the page and the screenshot script draw the same
// thing. The switch is passed in (it is a client component).

import type { ReactNode } from 'react'

import { FAYSAL_SENDER, READER_STATUS_LABEL, type ReaderStatus } from '@/lib/bankEmailCore'
import { formatDate, formatDateTime } from '@/lib/datetime'

export type FinanceSettingsState = {
  status: ReaderStatus
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  emailsRead: number
  creditsAdded: number
  ignoredCount: number
  configured: boolean
  missingEnv: string[]
}

const STATUS_TONE: Record<string, string> = {
  off: 'bg-white text-gray-600 border-gray-200',
  running: 'bg-tm-tint-green text-tm-green-deep border-tm-green-deep/20',
  locked: 'bg-tm-tint-red text-tm-red border-tm-red/30',
  error: 'bg-tm-tint-red text-tm-red border-tm-red/30',
}

export default function FinanceSettingsView({ s, cutoff, red, switchNode }: { s: FinanceSettingsState; cutoff: string; red: boolean; switchNode: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Finance settings</h1>
        <p className="text-xs text-gray-500">The bank email reader and the PayPro cut-off.</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" data-bank-reader="">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-tm-navy">Bank email reader</h2>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[s.status]}`} data-reader-status={s.status}>
            {READER_STATUS_LABEL[s.status]}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-700">
          Reads Faysal Bank credit alerts from a bank-only mailbox every 5 minutes and adds each credit to Finance. It only adds
          bank credits: it never approves a payment, activates a plan or gives a badge. It reads only emails from {FAYSAL_SENDER}{' '}
          that pass the bank&apos;s DKIM check, and never opens any other email. If the mailbox has mail from anyone else in the
          last 30 days it locks and reads nothing.
        </p>

        {s.status === 'locked' && (
          <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
            This mailbox isn&apos;t bank-only. The reader read nothing. Use a mailbox that only receives Faysal Bank alerts.
          </p>
        )}
        {red && (
          <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
            The reader has not worked for over an hour: {s.lastError ?? 'unknown error'}.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Last run</dt>
            <dd className="font-bold text-tm-navy">{s.lastRunAt ? formatDateTime(s.lastRunAt) : 'Never'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Last success</dt>
            <dd className="font-bold text-tm-navy">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : 'Never'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Emails read</dt>
            <dd className="font-bold text-tm-navy">{s.emailsRead}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Credits added</dt>
            <dd className="font-bold text-tm-navy">{s.creditsAdded}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Not credits (skipped)</dt>
            <dd className="font-bold text-tm-navy">{s.ignoredCount}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Mailbox settings</dt>
            <dd className="font-bold text-tm-navy">{s.configured ? 'All set' : `Missing: ${s.missingEnv.join(', ')}`}</dd>
          </div>
        </dl>
        {s.lastError && s.status !== 'running' && <p className="text-[11px] text-gray-600">Last error: {s.lastError}</p>}

        {switchNode}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-paypro-cutoff="">
        <h2 className="text-sm font-black text-tm-navy">PayPro</h2>
        <p className="text-xs leading-relaxed text-slate-700">
          PayPro is closed to new payments. Orders started before it closed still activate when paid, up to and including{' '}
          <strong>{formatDate(cutoff)}</strong>. After that day, a late PayPro payment is listed under Finance → Needs attention and
          nobody is activated.
        </p>
      </section>
    </div>
  )
}
