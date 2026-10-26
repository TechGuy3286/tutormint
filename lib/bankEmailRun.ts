// lib/bankEmailRun.ts — one run of the Faysal Bank email reader (owner,
// 26 Oct 2026), with the mailbox and the storage passed in. No IMAP, no
// database here, so the tests drive it with a fake mailbox and prove the
// rules: the safety lock reads From headers only; no body is opened for an
// email that is not from efbl@faysalbank.com; DKIM is required before a body
// is opened; credits only; nothing is ever activated, approved or granted.
//
// The real mailbox (imapflow) and store (Supabase) are in lib/bankEmailReader.ts.

import {
  decideCredit,
  dkimPass,
  isBankSender,
  isPayproPayout,
  LOCKED_MESSAGE,
  LOOKBACK_DAYS,
  mailboxLock,
  parseFaysalAlert,
  READ_KEYWORD,
  type ExistingCredit,
  type ParsedCredit,
} from './bankEmailCore'
import type { FinanceAlertKind } from './financeAlertsCore'

export type MailboxItem = { uid: number; from: string | null; keywords: ReadonlySet<string> }

export interface MailboxPort {
  /** From address + flags of every email since `since` — headers only. */
  listSince(since: Date): Promise<MailboxItem[]>
  /** A few headers of one email (never the body). */
  headers(uid: number): Promise<{ authResults: string[]; messageId: string | null; subject: string | null; date: Date | null }>
  /** The body of one email. Called ONLY for the bank's own, DKIM-verified mail. */
  body(uid: number): Promise<{ subject: string | null; text: string | null; html: string | null }>
  /** Mark as read and add the keyword. Never deletes or moves. */
  markProcessed(uid: number): Promise<void>
}

export interface CreditStore {
  existingCredits(): Promise<ExistingCredit[]>
  /** Message-IDs already dealt with (a credit or an alert). */
  knownMessageIds(ids: string[]): Promise<Set<string>>
  addCredit(c: ParsedCredit & { gateway: 'paypro' | 'manual'; messageId: string | null }): Promise<{ id: string } | 'duplicate'>
  linkCredit(creditId: string, messageId: string | null): Promise<void>
  alert(a: { kind: FinanceAlertKind; ref: string; title: string; detail?: string | null; amountPkr?: number | null; happenedAt?: string | null }): Promise<void>
}

export type RunResult =
  | { status: 'locked'; otherSenders: number }
  | {
      status: 'ok'
      seen: number
      read: number
      added: number
      linked: number
      duplicates: number
      ignored: number
      unreadable: number
      unverified: number
      unclear: number
    }

/** At most this many bank emails are opened in one run (the cron runs every 5 minutes). */
export const MAX_PER_RUN = 40

const pkDate = (d: Date | null) =>
  d ? d.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'unknown date'

export async function runBankReaderWith(mailbox: MailboxPort, store: CreditStore, opts: { now: Date; sysDomains: readonly string[] }): Promise<RunResult> {
  const since = new Date(opts.now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const list = await mailbox.listSince(since)

  // 1. Safety lock — From headers only, before anything else is read.
  const lock = mailboxLock(
    list.map((m) => m.from ?? ''),
    opts.sysDomains,
  )
  if (lock.locked) {
    await store.alert({
      kind: 'mailbox_locked',
      ref: `mailbox:${opts.now.toISOString().slice(0, 10)}`,
      title: LOCKED_MESSAGE,
      detail: `${lock.otherSenders} email${lock.otherSenders === 1 ? '' : 's'} in the last ${LOOKBACK_DAYS} days came from someone other than the bank. The reader read nothing. Use a mailbox that only receives Faysal Bank alerts.`,
      happenedAt: opts.now.toISOString(),
    })
    return { status: 'locked', otherSenders: lock.otherSenders }
  }

  // 2. The bank's own emails not yet dealt with, oldest first.
  const todo = list
    .filter((m) => isBankSender(m.from) && !m.keywords.has(READ_KEYWORD))
    .sort((a, b) => a.uid - b.uid)
    .slice(0, MAX_PER_RUN)

  const out = { status: 'ok' as const, seen: list.length, read: 0, added: 0, linked: 0, duplicates: 0, ignored: 0, unreadable: 0, unverified: 0, unclear: 0 }
  if (!todo.length) return out

  const heads = new Map<number, Awaited<ReturnType<MailboxPort['headers']>>>()
  for (const m of todo) heads.set(m.uid, await mailbox.headers(m.uid))
  const known = await store.knownMessageIds([...heads.values()].map((h) => h.messageId).filter((v): v is string => !!v))
  let existing = await store.existingCredits()

  for (const m of todo) {
    const h = heads.get(m.uid)!
    const ref = h.messageId ?? `uid:${m.uid}:${h.date?.toISOString() ?? ''}`
    if (h.messageId && known.has(h.messageId)) {
      await mailbox.markProcessed(m.uid)
      continue
    }
    // 3. DKIM for faysalbank.com — required before the body is opened.
    if (!dkimPass(h.authResults)) {
      out.unverified++
      await store.alert({
        kind: 'email_unverified',
        ref,
        title: "Couldn't verify sender",
        detail: `An email that says it is from the bank failed the DKIM check, so it was not read. Subject: ${(h.subject ?? '').slice(0, 120)} · received ${pkDate(h.date)}.`,
        happenedAt: h.date?.toISOString() ?? null,
      })
      await mailbox.markProcessed(m.uid)
      continue
    }

    const body = await mailbox.body(m.uid)
    out.read++
    const parsed = parseFaysalAlert({ subject: body.subject ?? h.subject, text: body.text, html: body.html })
    if (parsed.kind === 'not_credit') {
      out.ignored++
      await mailbox.markProcessed(m.uid)
      continue
    }
    if (parsed.kind === 'unreadable') {
      out.unreadable++
      await store.alert({
        kind: 'email_unreadable',
        ref,
        title: "Couldn't read this email",
        detail: `Subject: ${(h.subject ?? body.subject ?? '').slice(0, 120)} · received ${pkDate(h.date)}.`,
        happenedAt: h.date?.toISOString() ?? null,
      })
      await mailbox.markProcessed(m.uid)
      continue
    }

    const decision = decideCredit(parsed, existing)
    if (decision.action === 'duplicate') {
      out.duplicates++
      await store.linkCredit(decision.creditId, h.messageId)
    } else if (decision.action === 'link') {
      out.linked++
      await store.linkCredit(decision.creditId, h.messageId)
    } else if (decision.action === 'unclear') {
      out.unclear++
      await store.alert({
        kind: 'email_unclear',
        ref,
        title: 'Bank email needs a manual link',
        detail: `Rs ${parsed.amountPkr} on ${parsed.date}${parsed.time ? ` ${parsed.time}` : ''}: ${decision.reason}. It was not added — enter or link it by hand.`,
        amountPkr: parsed.amountPkr,
        happenedAt: h.date?.toISOString() ?? null,
      })
    } else {
      const r = await store.addCredit({ ...parsed, gateway: isPayproPayout(parsed.senderName) ? 'paypro' : 'manual', messageId: h.messageId })
      if (r === 'duplicate') out.duplicates++
      else {
        out.added++
        existing = [
          ...existing,
          { id: r.id, reference: parsed.reference, amountPkr: parsed.amountPkr, date: parsed.date, time: parsed.time, senderName: parsed.senderName, source: 'email', messageId: h.messageId },
        ]
      }
    }
    await mailbox.markProcessed(m.uid)
  }
  return out
}
