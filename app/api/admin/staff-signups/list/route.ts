import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadSignupList } from '@/lib/staffSignups'
import { currentStep, isStep, parsePeriod, type MemberRole } from '@/lib/staffSignupsCore'
import { maskMobile } from '@/lib/smsHealthCore'

// The accounts behind one number on Team activity → Paid sign-ups (owner, 15 Oct 2026).
// A participant may read only their own lists: another staff member's id, or
// the Team total, answers 403. Mobiles are masked.
//   GET ?staff=<id>|team&role=tutor|parent&step=<step>&period=today|yesterday|last7|month

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionPosting)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const sp = new URL(request.url).searchParams
  const role: MemberRole = sp.get('role') === 'parent' ? 'parent' : 'tutor'
  const step = sp.get('step')
  if (!isStep(role, step)) return NextResponse.json({ error: 'Unknown step.' }, { status: 400 })
  const staff = sp.get('staff') ?? gate.actor.id
  // inprogress=1: only tutors who have NOT paid (Team activity's "In progress").
  const inProgress = sp.get('inprogress') === '1'
  const result = await loadSignupList(gate.actor, staff, role, step, parsePeriod(sp.get('period')), undefined, { inProgress })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    staffName: result.staffName,
    accounts: result.accounts.map((a) => ({
      name: a.name,
      mobile: maskMobile(a.mobile),
      date: a.at[step] ?? null,
      currentStep: currentStep(a),
    })),
  })
}
