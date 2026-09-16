'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import PostTuitionForm, {
  type PostTuitionPayload,
  type PostTuitionValues,
} from '@/components/forms/PostTuitionForm'
import { submitSignal } from '@/lib/submit'
import { useToast } from '@/components/ui/Toast'

// Edit a team-posted tuition (owner PR9 §2). The SAME shared PostTuitionForm the
// admin post flow uses, in edit mode with the job's values prefilled, plus a
// REASON field (§2.2) that every save requires — read here, in the wrapper, and
// sent with the PATCH, so the shared form is untouched.

export default function AdminJobEditForm({
  jobId,
  initial,
}: {
  jobId: string
  initial: Partial<PostTuitionValues>
}) {
  const router = useRouter()
  const toast = useToast()
  const [reason, setReason] = useState('')

  const onSubmit = async (payload: PostTuitionPayload) => {
    if (reason.trim().length < 3) {
      return { ok: false as const, error: 'Give a reason for this change — it is recorded in the audit log.' }
    }
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      signal: submitSignal(),
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: reason.trim(),
        title: payload.title,
        masterIds: payload.masterIds,
        classLevel: payload.classLevel,
        classLevels: payload.classLevels,
        city: payload.city,
        area: payload.area,
        teachingMode: payload.teachingMode,
        budgetMin: payload.budgetMin,
        budgetMax: payload.budgetMax,
        schedule: payload.schedule,
        description: payload.description,
        genderPreference: payload.genderPreference,
        contactName: payload.contactName,
        contactPhone: payload.contactPhone,
        contactWhatsapp: payload.contactWhatsapp,
        contactEmail: payload.contactEmail,
        contactAddress: payload.contactAddress,
        contactSocial: payload.contactSocial,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      toast.error(json.error ?? 'Could not save the changes.')
      return { ok: false as const, error: json.error }
    }
    toast.success('Tuition updated.')
    router.push(`/admin/jobs/${jobId}`)
    router.refresh()
    return { ok: true as const }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4">
        <label htmlFor="edit-reason" className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
          Reason for this change (required — recorded in the audit log)
        </label>
        <textarea
          id="edit-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs outline-none focus:border-tm-navy"
          placeholder="e.g. Corrected the grades in the title to match the tuition"
        />
      </div>
      <PostTuitionForm
        teamBanner
        adminExtras
        mode="edit"
        initial={initial}
        submitLabel="Save changes"
        busyLabel="Saving…"
        onSubmit={onSubmit}
      />
    </div>
  )
}
