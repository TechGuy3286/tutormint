'use client'

import { useRouter } from 'next/navigation'

import PostTuitionForm, {
  type PostTuitionValues,
  type PostTuitionPayload,
} from '@/components/forms/PostTuitionForm'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'

// The parent's post/edit-a-tuition form. A thin adapter over the shared
// PostTuitionForm (owner, 11 Sep 2026): the form UI, the taxonomy cascade,
// "Write this for me", where/how/when, the gender preference, title and
// description all live once in that component. This wrapper supplies only what
// is parent-specific — the child selector, edit mode, the sign-in draft
// round-trip, and the GATED submit that opens the upgrade sheet on a refusal.

// Kept as an exported alias so the edit page's `initial={...}` keeps its type.
export type JobFormValues = PostTuitionValues

export default function JobForm({
  children,
  initial,
  mode = 'create',
}: {
  children: { id: string; name: string; class_level: string | null }[]
  initial?: Partial<PostTuitionValues>
  mode?: 'create' | 'edit'
}) {
  const router = useRouter()
  const toast = useToast()
  const upgradeSheet = useUpgradeSheet()

  const onSubmit = async (payload: PostTuitionPayload) => {
    const r = await postGated<{ jobTxId: string }>(
      '/api/parent/jobs',
      {
        jobId: payload.jobId,
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
        childId: payload.childId,
        genderPreference: payload.genderPreference,
      },
      upgradeSheet?.showGate,
      mode === 'edit' ? 'PATCH' : 'POST',
    )

    if (!r.ok) {
      return { ok: false as const, error: r.gated ? undefined : r.error, gated: r.gated }
    }

    // No silent successes: confirm before landing on the job. The toast provider
    // is in the root layout, so it survives the navigation.
    toast.success(mode === 'edit' ? 'Changes saved.' : 'Tuition posted.')
    router.push(
      mode === 'edit' ? `/parent/dashboard/job/${payload.jobId}` : `/parent/dashboard/job/${r.data.jobTxId}`,
    )
    router.refresh()
    return { ok: true as const }
  }

  return (
    <PostTuitionForm
      children={children}
      initial={initial}
      mode={mode}
      useDraft
      submitLabel={mode === 'edit' ? 'Save changes' : 'Post this tuition'}
      busyLabel="Saving…"
      onSubmit={onSubmit}
    />
  )
}
