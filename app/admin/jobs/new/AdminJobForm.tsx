'use client'

import { useRouter } from 'next/navigation'

import PostTuitionForm, { type PostTuitionPayload } from '@/components/forms/PostTuitionForm'
import { submitSignal } from '@/lib/submit'
import { useToast } from '@/components/ui/Toast'

// Post a tuition on the team-operated TutorMint account (owner, 9 Sep 2026).
//
// A thin adapter over the shared PostTuitionForm (owner, 11 Sep 2026): it is the
// SAME form a parent uses — same layout, copy, taxonomy cascade, "Write this for
// me", where/how/when, gender preference, title and description. This wrapper
// supplies only what an admin flow adds: the "Posted by TutorMint" banner, the
// ORIGIN field for the audit trail, the optional parent-contact block, and a
// plain POST to /api/admin/jobs/create (no verification gate, no quota, no child
// selector).

export default function AdminJobForm() {
  const router = useRouter()
  const toast = useToast()

  const onSubmit = async (payload: PostTuitionPayload) => {
    const res = await fetch('/api/admin/jobs/create', {
      signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        masterIds: payload.masterIds,
        classLevel: payload.classLevel,
        city: payload.city,
        area: payload.area,
        teachingMode: payload.teachingMode,
        budgetMin: payload.budgetMin,
        budgetMax: payload.budgetMax,
        schedule: payload.schedule,
        description: payload.description,
        genderPreference: payload.genderPreference,
        origin: payload.origin,
        contactName: payload.contactName,
        contactPhone: payload.contactPhone,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
    if (!res.ok) {
      toast.error(json.error ?? 'Could not post the tuition.')
      return { ok: false as const, error: json.error }
    }
    toast.success('Team tuition posted.')
    // Land on the admin detail for the new job, where applications are worked.
    router.push(json.id ? `/admin/jobs/${json.id}` : '/admin/jobs')
    router.refresh()
    return { ok: true as const }
  }

  return (
    <PostTuitionForm
      teamBanner
      adminExtras
      submitLabel="Post team tuition"
      busyLabel="Posting…"
      onSubmit={onSubmit}
    />
  )
}
