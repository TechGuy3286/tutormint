import 'server-only'

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { recordFinanceAlert, resolveFinanceAlertsByRef } from '@/lib/financeAlerts'
import {
  FAILING_ALERT_MS,
  missingImapEnv,
  READ_KEYWORD,
  readerErrorCategory,
  systemDomains,
  type ExistingCredit,
  type ReaderStatus,
} from '@/lib/bankEmailCore'
import { runBankReaderWith, type CreditStore, type MailboxItem, type MailboxPort, type RunResult } from '@/lib/bankEmailRun'

// The Faysal Bank email reader (owner, 26 Oct 2026). OFF by default; only the
// Owner switches it on (Finance → Settings). Runs from the 5-minute cron.
//
// The IMAP settings come from BANK_IMAP_HOST / _PORT / _USER / _PASSWORD and
// are NEVER printed or logged — errors are reduced to a plain category
// (readerErrorCategory) before they are stored. No email body is stored or
// logged; the rules (safety lock, DKIM, parsing, dedupe) are in
// lib/bankEmailCore and lib/bankEmailRun. The reader adds bank credits only:
// it never activates, approves or grants anything.

export const BANK_READER_ACTOR = 'system: bank email reader'

export type ReaderState = {
  enabled: boolean
  status: ReaderStatus
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  errorSince: string | null
  backfillDone: boolean
  emailsRead: number
  creditsAdded: number
  ignoredCount: number
  updatedAt: string | null
  configured: boolean
  missingEnv: string[]
}

export async function loadReaderState(): Promise<ReaderState> {
  const missing = missingImapEnv(process.env)
  const base: ReaderState = {
    enabled: false,
    status: 'off',
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    errorSince: null,
    backfillDone: false,
    emailsRead: 0,
    creditsAdded: 0,
    ignoredCount: 0,
    updatedAt: null,
    configured: missing.length === 0,
    missingEnv: missing,
  }
  const admin = createAdminClient()
  if (!admin) return base
  const { data } = await admin.from('bank_reader_state').select('*').eq('id', 1).maybeSingle()
  if (!data) return base
  return {
    ...base,
    enabled: !!data.enabled,
    status: (data.status as ReaderStatus) ?? 'off',
    lastRunAt: (data.last_run_at as string | null) ?? null,
    lastSuccessAt: (data.last_success_at as string | null) ?? null,
    lastError: (data.last_error as string | null) ?? null,
    errorSince: (data.error_since as string | null) ?? null,
    backfillDone: !!data.backfill_done,
    emailsRead: Number(data.emails_read ?? 0),
    creditsAdded: Number(data.credits_added ?? 0),
    ignoredCount: Number(data.ignored_count ?? 0),
    updatedAt: (data.updated_at as string | null) ?? null,
  }
}

/** The Owner's switch. Turning it on starts at "Running" and re-checks the
 *  mailbox on the next run; turning it off stops everything. */
export async function setReaderEnabled(enabled: boolean, by: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { error } = await admin
    .from('bank_reader_state')
    .update({
      enabled,
      status: enabled ? 'running' : 'off',
      last_error: null,
      error_since: null,
      updated_by: by,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  return !error
}

// ---------------------------------------------------------------------------
// The real mailbox

function imapClient(): ImapFlow {
  const port = Number(process.env.BANK_IMAP_PORT ?? 993)
  return new ImapFlow({
    host: String(process.env.BANK_IMAP_HOST),
    port,
    secure: port === 993,
    auth: { user: String(process.env.BANK_IMAP_USER), pass: String(process.env.BANK_IMAP_PASSWORD) },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableAutoIdle: true,
  })
}

function imapMailbox(client: ImapFlow): MailboxPort {
  return {
    async listSince(since) {
      const uids = await client.search({ since }, { uid: true })
      if (!uids || !uids.length) return []
      const out: MailboxItem[] = []
      // Envelope (From) and flags only — no body.
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, flags: true }, { uid: true })) {
        out.push({ uid: msg.uid, from: msg.envelope?.from?.[0]?.address ?? null, keywords: msg.flags ?? new Set() })
      }
      return out
    },
    async headers(uid) {
      const msg = await client.fetchOne(String(uid), { headers: ['authentication-results', 'message-id', 'subject', 'date'] }, { uid: true })
      const raw = msg && msg.headers ? msg.headers.toString('utf8') : ''
      const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
      const values = (name: string) =>
        unfolded
          .split(/\r?\n/)
          .filter((l) => l.toLowerCase().startsWith(`${name}:`))
          .map((l) => l.slice(name.length + 1).trim())
      const dateText = values('date')[0]
      const date = dateText ? new Date(dateText) : null
      return {
        authResults: values('authentication-results'),
        messageId: values('message-id')[0] ?? null,
        subject: values('subject')[0] ?? null,
        date: date && !Number.isNaN(date.getTime()) ? date : null,
      }
    },
    async body(uid) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) return { subject: null, text: null, html: null }
      const parsed = await simpleParser(msg.source)
      return { subject: parsed.subject ?? null, text: parsed.text ?? null, html: typeof parsed.html === 'string' ? parsed.html : null }
    },
    async markProcessed(uid) {
      // Read + our keyword. If the mailbox refuses custom keywords, "read" is
      // still set; the database's Message-ID record keeps it from repeating.
      try {
        await client.messageFlagsAdd(String(uid), ['\\Seen', READ_KEYWORD], { uid: true })
      } catch {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {})
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The store

async function siteOwnerId(): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function supabaseStore(): CreditStore {
  const admin = createAdminClient()!
  return {
    async existingCredits() {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const { data } = await admin
        .from('bank_transfers')
        .select('id, reference, amount_pkr, transferred_on, transferred_time, sender_name, source, message_id')
        .gte('transferred_on', since)
        .limit(1000)
      return (data ?? []).map(
        (r): ExistingCredit => ({
          id: r.id as string,
          reference: (r.reference as string | null) ?? null,
          amountPkr: Number(r.amount_pkr),
          date: String(r.transferred_on).slice(0, 10),
          time: r.transferred_time ? String(r.transferred_time).slice(0, 5) : null,
          senderName: (r.sender_name as string | null) ?? null,
          source: r.source as string,
          messageId: (r.message_id as string | null) ?? null,
        }),
      )
    },
    async knownMessageIds(ids) {
      if (!ids.length) return new Set()
      const [{ data: credits }, { data: alerts }] = await Promise.all([
        admin.from('bank_transfers').select('message_id').in('message_id', ids),
        admin.from('finance_alerts').select('ref').in('ref', ids),
      ])
      return new Set([...(credits ?? []).map((r) => r.message_id as string), ...(alerts ?? []).map((r) => r.ref as string)])
    },
    async addCredit(c) {
      const { data, error } = await admin
        .from('bank_transfers')
        .insert({
          transferred_on: c.date,
          transferred_time: c.time,
          amount_pkr: c.amountPkr,
          reference: c.reference,
          account_last4: c.senderLast4,
          sender_name: c.senderName,
          sender_bank: c.senderBank,
          source: 'email',
          gateway: c.gateway,
          channel: c.channel,
          message_id: c.messageId,
          recorded_by: null,
        })
        .select('id')
        .single()
      if (error) {
        if (error.code === '23505') return 'duplicate'
        throw new Error('Could not save a bank credit')
      }
      const owner = await siteOwnerId()
      if (owner) {
        await logAdminAction({
          actorId: owner,
          actorRole: 'owner',
          actorEmail: BANK_READER_ACTOR,
          action: 'settlement.credit_add_email',
          targetType: 'bank_transfer',
          targetId: data.id as string,
          // Amount, day, channel and type only — no name, account or email.
          detail: { amountPkr: c.amountPkr, date: c.date, channel: c.channel, payout: c.gateway === 'paypro' },
        })
      }
      return { id: data.id as string }
    },
    async linkCredit(creditId, messageId) {
      if (!messageId) return
      await admin.from('bank_transfers').update({ message_id: messageId }).eq('id', creditId).is('message_id', null)
    },
    async alert(a) {
      await recordFinanceAlert(a)
    },
  }
}

// ---------------------------------------------------------------------------
// One cron run

export type ReaderRun = { ran: false; why: 'off' | 'not_configured' | 'no_admin' } | { ran: true; status: ReaderStatus; result?: RunResult }

export async function runBankReader(now = new Date()): Promise<ReaderRun> {
  const admin = createAdminClient()
  if (!admin) return { ran: false, why: 'no_admin' }
  const state = await loadReaderState()
  if (!state.enabled) return { ran: false, why: 'off' }

  const stamp = now.toISOString()
  const fail = async (status: 'error' | 'locked', message: string) => {
    const errorSince = state.errorSince ?? stamp
    await admin
      .from('bank_reader_state')
      .update({ status, last_run_at: stamp, last_error: message, error_since: errorSince, updated_at: stamp })
      .eq('id', 1)
    if (now.getTime() - new Date(errorSince).getTime() > FAILING_ALERT_MS) {
      await recordFinanceAlert({
        kind: 'reader_failing',
        ref: `reader:${errorSince}`,
        title: 'Bank email reader is failing',
        detail: `${message}. Since ${new Date(errorSince).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (Pakistan time).`,
        happenedAt: errorSince,
      })
    }
  }

  if (!state.configured) {
    await fail('error', 'The mailbox settings are not set')
    return { ran: true, status: 'error' }
  }

  const client = imapClient()
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    let result: RunResult
    try {
      result = await runBankReaderWith(imapMailbox(client), supabaseStore(), { now, sysDomains: systemDomains(process.env.BANK_IMAP_HOST) })
    } finally {
      lock.release()
    }
    if (result.status === 'locked') {
      await fail('locked', "This mailbox isn't bank-only")
      return { ran: true, status: 'locked', result }
    }
    if (state.errorSince) await resolveFinanceAlertsByRef('reader_failing', `reader:${state.errorSince}`)
    // New credits from the bank's emails go through the same fee auto-linking
    // as credits added by hand (owner, 27 Oct 2026). Never stops the run.
    if (result.added > 0) {
      const owner = await siteOwnerId()
      if (owner) {
        const { runFeeAutoLink } = await import('@/lib/feeMatch')
        await runFeeAutoLink({ id: owner, adminRole: 'owner', email: BANK_READER_ACTOR }).catch(() => null)
      }
    }
    await admin
      .from('bank_reader_state')
      .update({
        status: 'running',
        last_run_at: stamp,
        last_success_at: stamp,
        last_error: null,
        error_since: null,
        backfill_done: true,
        emails_read: state.emailsRead + result.read,
        credits_added: state.creditsAdded + result.added,
        ignored_count: state.ignoredCount + result.ignored,
        updated_at: stamp,
      })
      .eq('id', 1)
    return { ran: true, status: 'running', result }
  } catch (e) {
    // Never the raw error: it can carry the host or the user name.
    await fail('error', readerErrorCategory(e))
    return { ran: true, status: 'error' }
  } finally {
    await client.logout().catch(() => {})
  }
}
