import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { allMembersForExport, type MemberFilters } from '@/lib/memberFeed'
import { logAdminAction } from '@/lib/auditLog'
import { normalisePkMobile } from '@/lib/phone'

// CSV export of the member directory, honouring the ACTIVE filters (the same
// q/role/status the admin is looking at). Owner + manager only — a member
// export carries mobile numbers off the platform — and every export writes an
// admin_audit_log row (actor, the filter set, and the row count), so who took
// which slice of the directory, when, is answerable.
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
  const filters: MemberFilters = {
    q: url.searchParams.get('q') ?? '',
    role: url.searchParams.get('role') ?? '',
    status: url.searchParams.get('status') ?? '',
  }

  const members = await allMembersForExport(filters)

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
    detail: { rowCount: members.length, filters },
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
