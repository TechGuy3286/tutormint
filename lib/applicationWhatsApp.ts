// lib/applicationWhatsApp.ts
//
// The check-in link for one application (owner, 22 Oct 2026): the tutor's
// number (read here, never sent to the page), the stage's English message
// (lib/applicationStageCore checkInMessage) and adminWaLink — the same wa.me
// builder every admin WhatsApp button uses.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { adminWaLink } from '@/lib/adminWhatsAppCore'
import { checkInMessage, isStage, type Stage } from '@/lib/applicationStageCore'
import { formatName } from '@/lib/formatName'
import { tuitionPath } from '@/lib/slugs'

export async function applicationCheckInLink(
  applicationId: string,
): Promise<{ href: string; jobId: string; tutorId: string; stage: Stage } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: app } = await admin.from('applications').select('id, job_id, tutor_id, stage').eq('id', applicationId).maybeSingle()
  if (!app?.job_id) return null
  const [{ data: person }, { data: job }] = await Promise.all([
    admin.from('profiles').select('full_name, phone_number, whatsapp').eq('id', app.tutor_id as string).maybeSingle(),
    admin.from('jobs').select('id, title, city, public_slug, job_tx_id').eq('id', app.job_id as string).maybeSingle(),
  ])
  const stage: Stage = isStage(app.stage) ? app.stage : 'applied'
  const text = checkInMessage({
    stage,
    tutorName: formatName(person?.full_name as string | null),
    title: (job?.title as string | null) ?? 'your tuition',
    city: (job?.city as string | null) ?? null,
    tuitionPath: job
      ? tuitionPath({ public_slug: job.public_slug as string | null, city: job.city as string | null, job_tx_id: job.job_tx_id as string | null, id: job.id as string })
      : null,
  })
  const href = adminWaLink((person?.whatsapp as string | null) || (person?.phone_number as string | null), text)
  return href ? { href, jobId: app.job_id as string, tutorId: app.tutor_id as string, stage } : null
}
