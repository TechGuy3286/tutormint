// lib/emailHealth.ts — what Admin → Settings → Email and the Overview to-do read
// (owner, 16 Oct 2026). Reads email_sends / email_runs (migration 183), which
// lib/email/send.ts writes for every message.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailConfigured } from '@/lib/email/send'

export const EMAIL_FAILED_WINDOW_DAYS = 7

export type EmailFailure = {
  id: string
  at: string
  mode: 'one' | 'bulk'
  job: string
  template: string | null
  recipient: string
  status: 'failed' | 'skipped'
  attempts: number
  httpStatus: number | null
  error: string | null
}

export type EmailRun = {
  id: string
  job: string
  startedAt: string
  finishedAt: string | null
  attempted: number
  delivered: number
  failed: number
  skipped: number
  requests: number
}

export type EmailHealth = {
  configured: boolean
  sent24h: number
  sent7d: number
  failed7d: number
  skipped7d: number
  lastSentAt: string | null
  failures: EmailFailure[]
  runs: EmailRun[]
}

/** Emails that permanently failed in the last 7 days — the Overview to-do list. */
export async function loadEmailFailures(now = new Date(), limit = 500): Promise<EmailFailure[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(now.getTime() - EMAIL_FAILED_WINDOW_DAYS * 86_400_000).toISOString()
  const { data } = await admin
    .from('email_sends')
    .select('id, created_at, mode, job, template, recipient, status, attempts, http_status, error')
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map(toFailure)
}

function toFailure(r: Record<string, unknown>): EmailFailure {
  return {
    id: r.id as string,
    at: r.created_at as string,
    mode: r.mode as 'one' | 'bulk',
    job: r.job as string,
    template: (r.template as string | null) ?? null,
    recipient: r.recipient as string,
    status: r.status as 'failed' | 'skipped',
    attempts: r.attempts as number,
    httpStatus: (r.http_status as number | null) ?? null,
    error: (r.error as string | null) ?? null,
  }
}

async function count(status: string, sinceIso: string): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count: n } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', status).gte('created_at', sinceIso)
  return n ?? 0
}

export async function loadEmailHealth(now = new Date()): Promise<EmailHealth> {
  const admin = createAdminClient()
  const day = new Date(now.getTime() - 86_400_000).toISOString()
  const week = new Date(now.getTime() - EMAIL_FAILED_WINDOW_DAYS * 86_400_000).toISOString()
  const [sent24h, sent7d, failed7d, skipped7d] = await Promise.all([
    count('sent', day),
    count('sent', week),
    count('failed', week),
    count('skipped', week),
  ])
  let lastSentAt: string | null = null
  let failures: EmailFailure[] = []
  let runs: EmailRun[] = []
  if (admin) {
    const [last, bad, rs] = await Promise.all([
      admin.from('email_sends').select('created_at').eq('status', 'sent').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin
        .from('email_sends')
        .select('id, created_at, mode, job, template, recipient, status, attempts, http_status, error')
        .in('status', ['failed', 'skipped'])
        .gte('created_at', week)
        .order('created_at', { ascending: false })
        .limit(100),
      admin.from('email_runs').select('id, job, started_at, finished_at, attempted, delivered, failed, skipped, requests').order('started_at', { ascending: false }).limit(30),
    ])
    lastSentAt = (last.data?.created_at as string | undefined) ?? null
    failures = (bad.data ?? []).map(toFailure)
    runs = (rs.data ?? []).map((r) => ({
      id: r.id as string,
      job: r.job as string,
      startedAt: r.started_at as string,
      finishedAt: (r.finished_at as string | null) ?? null,
      attempted: r.attempted as number,
      delivered: r.delivered as number,
      failed: r.failed as number,
      skipped: r.skipped as number,
      requests: r.requests as number,
    }))
  }
  return { configured: emailConfigured(), sent24h, sent7d, failed7d, skipped7d, lastSentAt, failures, runs }
}

/** The daily cron deletes log rows older than 90 days (a log, not a member record). */
export async function purgeOldEmailSends(now = new Date()): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  const { data } = await admin.from('email_sends').delete().lt('created_at', cutoff).select('id')
  await admin.from('email_runs').delete().lt('started_at', cutoff)
  return (data ?? []).length
}
