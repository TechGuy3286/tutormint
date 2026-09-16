import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { updateTeamJob, type JobInput } from '@/lib/jobs'
import { parseBody, z, text, rupees } from '@/lib/validate'

// Edit a team-posted tuition (owner PR9 §2). PATCH the SAME row: the job id, TM
// reference, public URL and applications are untouched. Owner + Admin +
// Operations (SCREEN_ACCESS.jobsPost — the same roles that post a team tuition).
// Every edit needs a reason; updateTeamJob writes the audit entry with the
// changed fields, and refuses a parent-posted job (§2.3).

export const dynamic = 'force-dynamic'

const EditBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason for this change.').max(500),
  title: text({ min: 1, max: 200, label: 'Title' }),
  masterIds: z.array(z.coerce.number().int().positive()).max(30).default([]),
  classLevel: z.string().max(120).nullish(),
  classLevels: z.array(z.string().max(120)).max(30).default([]),
  city: z.string().max(120).nullish(),
  area: z.string().max(120).nullish(),
  teachingMode: z.string().max(60).nullish(),
  budgetPkr: rupees.nullish(),
  budgetMin: rupees.nullish(),
  budgetMax: rupees.nullish(),
  schedule: z.string().max(500).nullish(),
  description: z.string().max(5000, 'Keep the description under 5000 characters.').nullish(),
  genderPreference: z.enum(['male', 'female', 'trans']).nullish(),
  contactName: z.string().max(120).nullish(),
  contactPhone: z.string().max(40).nullish(),
  contactWhatsapp: z.string().max(40).nullish(),
  contactEmail: z.string().max(200).nullish(),
  contactAddress: z.string().max(300).nullish(),
  contactSocial: z.string().max(200).nullish(),
})

function parseInput(body: z.infer<typeof EditBody>): JobInput {
  const str = (v: string | null | undefined) => {
    const s = (v ?? '').trim()
    return s.length > 0 ? s : null
  }
  return {
    title: body.title,
    masterIds: Array.from(new Set(body.masterIds)),
    classLevel: str(body.classLevel),
    classLevels: body.classLevels ?? [],
    city: str(body.city),
    area: str(body.area),
    teachingMode: str(body.teachingMode),
    budgetPkr: body.budgetPkr ?? null,
    budgetMin: body.budgetMin ?? null,
    budgetMax: body.budgetMax ?? null,
    schedule: str(body.schedule),
    description: str(body.description),
    childId: null,
    genderPreference: body.genderPreference ?? null,
    contactName: str(body.contactName),
    contactPhone: str(body.contactPhone),
    contactWhatsapp: str(body.contactWhatsapp),
    contactEmail: str(body.contactEmail),
    contactAddress: str(body.contactAddress),
    contactSocial: str(body.contactSocial),
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { id } = await params
  const parsed = await parseBody(request, EditBody)
  if (!parsed.ok) return parsed.response

  const result = await updateTeamJob(
    id,
    parseInput(parsed.data),
    { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email },
    parsed.data.reason,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true, publicSlug: result.publicSlug })
}
