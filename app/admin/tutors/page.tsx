import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import TutorModerationClient, { type QueueTutor } from './TutorModerationClient'

// Tutor moderation queue. Server component: the gate runs before anything
// renders, and the rows are fetched with the service-role client because an
// admin needs to see tutors that RLS would otherwise hide.

export const dynamic = 'force-dynamic'

export default async function AdminTutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.tutors)
  const { filter = 'pending' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="text-xs font-bold text-[#d60008] bg-red-50 border border-red-200 rounded-xl p-4">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so the queue cannot be loaded.
      </p>
    )
  }

  let query = admin
    .from('tutor_profiles')
    .select(
      'id, full_name, email, headline, city, area, avatar_url, video_youtube_id, video_status, video_attempts, verification_status, rating_avg, rating_count, degrees, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (filter === 'pending') query = query.eq('video_status', 'uploaded')
  else if (filter === 'suspended') query = query.eq('verification_status', 'suspended')

  const { data: tutors } = await query

  const ids = (tutors ?? []).map((t) => t.id)

  const [{ data: profiles }, { data: docs }] = await Promise.all([
    admin.from('profiles').select('id, profile_completion, cnic_number, phone_number').in('id', ids.length ? ids : ['-']),
    admin.from('user_documents').select('id, user_id, kind, label').in('user_id', ids.length ? ids : ['-']),
  ])

  const rows: QueueTutor[] = (tutors ?? []).map((t) => {
    const p = profiles?.find((x) => x.id === t.id)
    return {
      id: t.id,
      fullName: t.full_name,
      email: t.email,
      headline: t.headline,
      city: t.city,
      area: t.area,
      avatarUrl: t.avatar_url,
      videoYoutubeId: t.video_youtube_id,
      videoStatus: t.video_status ?? 'none',
      videoAttempts: t.video_attempts ?? 0,
      verificationStatus: t.verification_status ?? 'pending',
      ratingAvg: Number(t.rating_avg ?? 0),
      ratingCount: t.rating_count ?? 0,
      degrees: (t.degrees ?? []) as string[],
      completion: p?.profile_completion ?? 0,
      cnicNumber: p?.cnic_number ?? null,
      phone: p?.phone_number ?? null,
      documents: (docs ?? [])
        .filter((d) => d.user_id === t.id)
        .map((d) => ({ id: d.id, kind: d.kind as 'cnic' | 'degree', label: d.label })),
    }
  })

  return <TutorModerationClient tutors={rows} filter={filter} />
}
