import 'server-only'

// lib/dailyReport.ts
//
// The data behind Team activity's "Send today's report on WhatsApp" button
// (owner, 16 Oct 2026). Read from the same sources the page reads:
//   - tuitions posted today: admin_audit_log 'job.post' by staff (the Tuitions
//     posted tab, lib/tuitionPosting), joined to the jobs they created;
//   - signed up today: credited accounts whose first qualifying payment was
//     approved today (lib/staffSignups loadCreditedAccounts → `at.paid`, the
//     "Signed up" status of the Paid sign-ups tab), cut to what the viewer may
//     see on that tab (everyone, or only their own).
// The text itself is built by lib/dailyReportCore.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { formatDate } from '@/lib/datetime'
import { budgetLabel } from '@/lib/feeBands'
import { labelsForMasterIdsServer } from '@/lib/taxonomyServer'
import { pkDayStartMs } from '@/lib/overviewItemsCore'
import { loadCreditedAccounts } from '@/lib/staffSignups'
import { seesEveryone, signedUpIn } from '@/lib/staffSignupsCore'
import { buildDailyReport, whatsappReportLink, type ReportSignup, type ReportTuition } from '@/lib/dailyReportCore'

function subjectsOf(labels: string[]): string | null {
  const names = [...new Set(labels.map((l) => (l.includes(' — ') ? l.split(' — ').pop()! : l).trim()).filter(Boolean))]
  if (names.length === 0) return null
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

export async function loadDailyReport(
  viewer: { id: string; adminRole: string | null },
  nowMs = Date.now(),
): Promise<{ text: string; href: string }> {
  const dayStart = pkDayStartMs(nowMs)
  const range = { start: dayStart, end: nowMs + 1 }
  const admin = createAdminClient()
  const tuitions: ReportTuition[] = []
  const signups: ReportSignup[] = []

  if (admin) {
    const [{ data: staff }, accounts] = await Promise.all([
      admin.from('profiles').select('id, full_name, email').eq('role', 'admin'),
      loadCreditedAccounts(),
    ])
    const staffRows = staff ?? []
    const nameOf = new Map(staffRows.map((s) => [s.id as string, formatName((s.full_name as string | null) ?? '') || (s.email as string | null) || '—']))

    // Tuitions posted today (by staff).
    const ids = staffRows.map((s) => s.id as string)
    const posts = ids.length
      ? await pageAll((from, to) =>
          admin
            .from('admin_audit_log')
            .select('id, target_id, created_at')
            .eq('action', 'job.post')
            .in('actor_id', ids)
            .gte('created_at', new Date(dayStart).toISOString())
            .order('created_at')
            .order('id')
            .range(from, to),
        )
      : []
    const jobIds = [...new Set(posts.map((p) => p.target_id as string).filter(Boolean))]
    if (jobIds.length) {
      const [{ data: jobs }, { data: subj }] = await Promise.all([
        admin.from('jobs').select('id, ref_id, area, city, budget_min_pkr, budget_max_pkr, budget_pkr').in('id', jobIds),
        admin.from('job_subjects').select('job_id, master_id').in('job_id', jobIds),
      ])
      const mastersBy = new Map<string, number[]>()
      for (const r of subj ?? []) {
        const l = mastersBy.get(r.job_id as string) ?? []
        l.push(Number(r.master_id))
        mastersBy.set(r.job_id as string, l)
      }
      const byId = new Map((jobs ?? []).map((j) => [j.id as string, j]))
      for (const id of jobIds) {
        const j = byId.get(id)
        if (!j) continue
        const labels = await labelsForMasterIdsServer(mastersBy.get(id) ?? []).catch(() => [])
        tuitions.push({
          ref: (j.ref_id as string | null) ?? '—',
          subject: subjectsOf(labels),
          area: ((j.area as string | null) ?? '').trim() || ((j.city as string | null) ?? '').trim() || null,
          fee: budgetLabel(j.budget_min_pkr as number | null, j.budget_max_pkr as number | null, j.budget_pkr as number | null),
        })
      }
    }

    // Signed up today: paid today, in the viewer's scope.
    const visible = seesEveryone(viewer.adminRole) ? accounts : accounts.filter((a) => a.staffId === viewer.id)
    const paid = [...signedUpIn(visible, 'tutor', range), ...signedUpIn(visible, 'parent', range)].sort(
      (a, b) => Date.parse(a.at.paid ?? '') - Date.parse(b.at.paid ?? ''),
    )
    for (const a of paid) signups.push({ name: a.name, role: a.role, staff: nameOf.get(a.staffId) ?? '—' })
  }

  const text = buildDailyReport(formatDate(new Date(nowMs)), tuitions, signups)
  return { text, href: whatsappReportLink(text) }
}
