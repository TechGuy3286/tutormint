import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { allMembersForExport, type MemberFilters } from '@/lib/memberFeed'
import { logAdminAction } from '@/lib/auditLog'
import { normalisePkMobile } from '@/lib/phone'
import { listPage } from '@/lib/adminSummary'
import { peopleListQuery, PEOPLE_LIST_KEYS } from '@/lib/peopleListQuery'
import type { MemberRow } from '@/lib/memberFeed'

// CSV export of the member directory, honouring the ACTIVE filters (the same
// q/role/status the admin is looking at). Owner + manager only — a member
// export carries mobile numbers off the platform — and every export writes an
// admin_audit_log row (actor, the filter set, and the row count), so who took
// which slice of the directory, when, is answerable.
//
// People (owner, 16 Nov 2026): with ?tab=tutors|parents the file is EXACTLY the
// list on screen — the same tab, stage, follow-up chip, plan, sign-up day and
// search, run through the same query (lib/peopleListQuery) and in the same
// order. ?tab=staff is the staff list. The older ?role/q/status form still works.
//
// Mobiles are written in the WhatsApp-ready 92… form (lib/phone.ts), so the file
// can be imported into a broadcast tool without reformatting.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csvCell(v: string | null | undefined): string {
  const s = (v ?? '').toString()
  // Quote if it contains a comma, quote, newline, or a leading = + - @ (CSV
  // injection into a spreadsheet). Double any embedded quotes.
  const risky = /[",\n\r]/.test(s) || /^[=+\-@]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return risky ? `"${escaped}"` : escaped
}

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.usersExport)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const tab = url.searchParams.get('tab')
  const filters: MemberFilters = {
    q: url.searchParams.get('q') ?? '',
    role: tab === 'staff' ? 'admin' : (url.searchParams.get('role') ?? ''),
    status: tab === 'staff' ? '' : (url.searchParams.get('status') ?? ''),
  }

  let members: MemberRow[]
  let logged: Record<string, unknown> = filters
  if (tab === 'tutors' || tab === 'parents') {
    const sp: Record<string, string> = {}
    for (const k of PEOPLE_LIST_KEYS) {
      const v = url.searchParams.get(k)
      if (v != null) sp[k] = v
    }
    members = await peopleListMembers(tab, sp)
    logged = { people: sp }
  } else {
    members = await allMembersForExport(filters)
  }

  const header = ['Name', 'Role', 'Mobile', 'WhatsApp', 'City', 'Plan', 'Verification', 'Phone verified via', 'Status', 'Joined']
  const lines = [header.join(',')]
  for (const m of members) {
    lines.push(
      [
        csvCell(m.name),
        csvCell(m.role),
        csvCell(normalisePkMobile(m.phone) ?? m.phone ?? ''),
        csvCell(normalisePkMobile(m.whatsapp) ?? m.whatsapp ?? ''),
        csvCell(m.city),
        csvCell(m.plan ?? 'No plan'),
        csvCell(m.verified ? 'Verified' : 'Not verified'),
        // 'bridge' marks accounts proved by the BRIDGE_OTP stopgap.
        csvCell(m.phoneVerifiedVia ?? ''),
        csvCell(m.banned ? 'Banned' : m.suspended ? 'Suspended' : 'Active'),
        csvCell(m.createdAt ? m.createdAt.slice(0, 10) : ''),
      ].join(','),
    )
  }
  // A UTF-8 BOM so Excel opens Urdu names and the 92… numbers correctly.
  const csv = '﻿' + lines.join('\r\n') + '\r\n'

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'member.export',
    targetType: 'members',
    targetId: 'directory',
    detail: { rowCount: members.length, filters: logged },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tutormint-members-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Every member of a People list, in the list's own order. */
async function peopleListMembers(tab: 'tutors' | 'parents', sp: Record<string, string>): Promise<MemberRow[]> {
  const lq = peopleListQuery(tab, sp, { showAll: sp.all === '1', showDeleted: sp.deleted === '1', nowMs: Date.now() })
  const ids: string[] = []
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await listPage<unknown>(lq.list, {
      fixed: lq.fixed,
      since: lq.since,
      until: lq.until,
      q: lq.q,
      rows: lq.rowQuery,
      order: lq.order,
      offset,
      limit: 500,
    })
    ids.push(...page.rows.map((r) => r.id))
    if (page.rows.length < 500 || ids.length >= page.total) break
  }
  const byId = new Map<string, MemberRow>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    for (const m of await allMembersForExport({ q: '', role: '', status: '', ids: chunk })) byId.set(m.id, m)
  }
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}
