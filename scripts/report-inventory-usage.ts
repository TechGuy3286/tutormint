/**
 * READ-ONLY report: 30-day usage figures for the clean-up inventory
 * (admin screens, public pages, crons, templates, settings).
 *
 * Only SELECT statements. Writes nothing. Prints counts, keys and paths only —
 * never a phone number, email, CNIC, account number or key.
 *
 *   npx tsx --env-file=.env.local scripts/report-inventory-usage.ts [--json <file>]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { writeFileSync } from 'node:fs'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function normPath(p: string): string {
  return (p || '/')
    .split('?')[0]
    .replace(UUID, '[id]')
    .replace(/^\/tutor\/(?!dashboard|onboarding|complete-profile|claim|verify|register|login)[^/]+$/, '/tutor/[slug]')
    .replace(/^\/tuitions\/[^/]+\/[^/]+$/, '/tuitions/[city]/[slug]')
    .replace(/^\/tuition-jobs\/school\/[^/]+$/, '/tuition-jobs/school/[school]')
    .replace(/^\/tuition-jobs\/(?!school)[^/]+\/[^/]+$/, '/tuition-jobs/[city]/[variant]')
    .replace(/^\/tuition-jobs\/(?!school)[^/]+$/, '/tuition-jobs/[city]')
    .replace(/^\/tutors\/[^/]+\/[^/]+$/, '/tutors/[city]/[subject]')
    .replace(/^\/blog\/(?!feed)[^/]+$/, '/blog/[slug]')
    .replace(/^\/parent\/(?!dashboard|verify|login)[^/]+$/, '/parent/[id]')
    .replace(/\/overview\/(?!todo-unmet)[^/]+$/, '/overview/[key]')
    .replace(/\/pay\/(manual|simulator)\/[^/]+$/, '/pay/$1/[ref]')
    .replace(/\/messages\/[^/]+$/, '/messages/[threadId]')
    .replace(/\/applications\/[^/]+$/, '/applications/[id]')
    .replace(/\/job\/[^/]+/, '/job/[jobId]')
    .replace(/\/+$/, '') || '/'
}

async function q<T = Record<string, unknown>>(c: pg.Client, label: string, sql: string): Promise<T[]> {
  try {
    await c.query('savepoint s')
    const r = await c.query(sql)
    await c.query('release savepoint s')
    return r.rows as T[]
  } catch (e) {
    await c.query('rollback to savepoint s').catch(() => {})
    console.error(`[${label}] failed: ${(e as Error).message}`)
    return []
  }
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  const out: Record<string, unknown> = {}
  try {
    await c.query('begin read only')

    // Page views (signed-in only — the tracker writes nothing for guests).
    const views = await q<{ path: string; is_staff: boolean; n: string; users: string }>(c, 'views', `
      select e.path, s.is_staff, count(*)::text n, count(distinct e.user_id)::text users
      from activity_events e join activity_sessions s on s.id = e.session_id
      where e.kind = 'page_view' and e.created_at > now() - interval '30 days'
      group by 1,2`)
    const agg: Record<string, { staff: number; member: number; users: Set<string> | number }> = {}
    for (const v of views) {
      const k = normPath(v.path)
      agg[k] ??= { staff: 0, member: 0, users: 0 }
      if (v.is_staff) agg[k].staff += Number(v.n)
      else agg[k].member += Number(v.n)
      ;(agg[k].users as number) += Number(v.users)
    }
    out.pageViews = agg

    out.audit = await q(c, 'audit', `
      select action, count(*)::int n from admin_audit_log
      where created_at > now() - interval '30 days' group by 1 order by 2 desc`)

    out.templates = await q(c, 'templates', `select key, active, title from admin_message_templates order by key`)

    out.emailSends = await q(c, 'email_sends', `
      select template, status, count(*)::int n from email_sends
      where created_at > now() - interval '30 days' group by 1,2 order by 1`)

    out.memberFollowUps = await q(c, 'member_follow_ups', `
      select coalesce(template_key,'(none)') template_key, source, count(*)::int n from member_follow_ups
      where created_at > now() - interval '30 days' and undone_at is null group by 1,2 order by 3 desc`)

    out.appFollowUps = await q(c, 'application_follow_ups', `
      select message_key, recipient, count(*)::int n from application_follow_ups
      where created_at > now() - interval '30 days' and undone_at is null group by 1,2 order by 3 desc`)

    out.auditTemplateRefs = await q(c, 'audit template refs', `
      select coalesce(detail->>'templateKey', detail->>'template_key', detail->>'template', detail->>'messageType', detail->>'key') k,
             action, count(*)::int n
      from admin_audit_log where created_at > now() - interval '30 days'
        and coalesce(detail->>'templateKey', detail->>'template_key', detail->>'template', detail->>'messageType', detail->>'key') is not null
      group by 1,2 order by 3 desc`)

    out.adminMessages = await q(c, 'admin_messages', `
      select coalesce(template_key,'(free text)') template_key, direction, count(*)::int n from admin_messages
      where created_at > now() - interval '30 days' group by 1,2 order by 3 desc`)

    out.settings = await q(c, 'app_settings', `
      select key, (value is not null and btrim(value::text) not in ('', '""', 'null')) as set from app_settings order by key`)

    out.siteVisits = await q(c, 'site_visit_counts', `
      select kind, sum(count)::int n from site_visit_counts where day > (now() - interval '30 days')::date group by 1`)

    // Cron evidence.
    out.emailRuns = await q(c, 'email_runs', `
      select job, count(*)::int runs, sum(attempted)::int attempted, max(started_at) last from email_runs
      where started_at > now() - interval '30 days' group by 1 order by 1`)
    out.indexing = await q(c, 'indexing_attempts', `
      select ok, count(*)::int n, max(attempted_at) last from indexing_attempts where attempted_at > now() - interval '30 days' group by 1`)
    out.sms = await q(c, 'sms_sends', `
      select purpose, outcome, count(*)::int n from sms_sends where created_at > now() - interval '30 days' group by 1,2`)
    out.smsAlerts = await q(c, 'sms_alerts', `select count(*)::int n, max(created_at) last from sms_alerts where created_at > now() - interval '30 days'`)
    out.bankReader = await q(c, 'bank_reader_state', `select enabled, status, last_run_at, last_success_at, emails_read, credits_added from bank_reader_state`)
    out.payproPayments = await q(c, 'paypro payments', `
      select provider, status, count(*)::int n from payments where created_at > now() - interval '30 days' group by 1,2 order by 1`)
    out.tuitionPauses = await q(c, 'pauses', `
      select pause_source, count(*)::int n from jobs where paused_at > now() - interval '30 days' group by 1`)
    out.postsPublished = await q(c, 'posts', `select status, count(*)::int n from posts group by 1`)
    out.contentSuggestions = await q(c, 'content_suggestions', `
      select source, status, count(*)::int n from content_suggestions where updated_at > now() - interval '30 days' group by 1,2`)
    out.tutorAlerts = await q(c, 'tutor_search_alerts', `select count(*)::int n from tutor_search_alerts where created_at > now() - interval '30 days'`)
    out.ads = await q(c, 'ad_events', `select kind, count(*)::int n from ad_events where occurred_at > now() - interval '30 days' group by 1`)
    out.adsRows = await q(c, 'advertisements', `select status, count(*)::int n from advertisements group by 1`)
    out.reviews = await q(c, 'reviews', `select status, count(*)::int n from reviews where created_at > now() - interval '30 days' group by 1`)
    out.reports = await q(c, 'reports', `select count(*)::int n from reports where created_at > now() - interval '30 days'`)
    out.demos = await q(c, 'demo_requests', `select count(*)::int n from demo_requests where created_at > now() - interval '30 days'`)
    out.children = await q(c, 'children', `select count(*)::int n from children`)
    out.importedTutors = await q(c, 'imports', `select count(*)::int n, max(p.created_at) last from tutor_profiles tp join profiles p on p.id = tp.id where tp.imported`)
    out.claims = await q(c, 'claims', `select status, count(*)::int n from staff_signup_claims group by 1`)
    out.threads = await q(c, 'messages', `select count(*)::int n from messages where created_at > now() - interval '30 days'`)
    out.viewAs = await q(c, 'view_as', `select count(*)::int n from view_as_sessions where expires_at > now() - interval '30 days'`)
    out.erasures = await q(c, 'erasures', `select status, count(*)::int n from account_erasures group by 1`)
    out.merges = await q(c, 'merges', `select status, count(*)::int n from member_merges group by 1`)
    out.withdrawals = await q(c, 'withdrawals', `select count(*)::int n from contact_withdrawals`)
    out.holds = await q(c, 'holds', `select count(*)::int n from contact_holds`)
    out.emailQueue = await q(c, 'email_queue', `select kind, count(*)::int n from email_queue where created_at > now() - interval '30 days' group by 1`)
    out.pendingSignups = await q(c, 'pending_signups', `select count(*)::int n from pending_signups`)
    out.unmet = await q(c, 'search_unmet', `select count(*)::int n from search_unmet where created_at > now() - interval '30 days'`)
    out.anonSearch = await q(c, 'anon_search_events', `select count(*)::int n from anon_search_events where created_at > now() - interval '30 days' and excluded is null`)
    out.featuredSends = await q(c, 'featured_whatsapp_sends', `select count(*)::int n from featured_whatsapp_sends where sent_at > now() - interval '30 days'`)
    out.contactLogs = await q(c, 'tutor_contact_logs', `select count(*)::int n from tutor_contact_logs where created_at > now() - interval '30 days'`)
    out.memberNotes = await q(c, 'member_notes', `select count(*)::int n from member_notes where created_at > now() - interval '30 days'`)
    out.chatSimulator = await q(c, 'simulator payments', `select count(*)::int n from payments where provider = 'simulator'`)

    await c.query('rollback')
  } finally {
    await c.end()
  }

  const i = process.argv.indexOf('--json')
  if (i > 0 && process.argv[i + 1]) writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1))
  else console.log(JSON.stringify(out, null, 1))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
