import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'

// Moved from the tutor profile page (push 3, owner 1 Nov 2026): the page is now
// cached for everyone, so the view is reported by the browser
// (POST /api/viewer/tutor/view) with the page's referrer, and recorded here
// exactly as the page recorded it before.

/**
 * Record the view for the tutor's dashboard teaser.
 *
 * Written with the service-role client because profile_views is admin-read
 * only: if tutors could select their own rows with the anon key, the
 * "anonymised until you upgrade" teaser would be decoration, since viewer_id
 * would be one query away.
 *
 * The search context comes from the Referer when it is one of our own browse
 * URLs -- that is what turns the teaser from "someone viewed you" into "a
 * parent searching O Level Physics in Gulberg viewed you".
 */
export async function recordProfileView(tutorId: string, viewerId: string | null, viewerRole: string | null, referer: string | null) {
  const admin = createAdminClient()
  if (!admin) return
  if (viewerId === tutorId) return // your own profile is not a lead

  if (viewerId) {
    // One row per viewer per hour, so a refresh is not a new "view".
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await admin
      .from('profile_views')
      .select('id')
      .eq('tutor_id', tutorId)
      .eq('viewer_id', viewerId)
      .gt('created_at', hourAgo)
      .maybeSingle()
    if (recent) return
  }

  let searchSubject: string | null = null
  let searchArea: string | null = null
  let searchCity: string | null = null

  try {
    if (referer) {
      const url = new URL(referer)
      if (url.pathname.startsWith('/browse/')) {
        searchSubject = url.searchParams.get('subject')
        searchArea = url.searchParams.get('area')
        searchCity = url.searchParams.get('city')
      }
    }
  } catch {
    // A malformed Referer must never cost us the view row.
  }

  await admin.from('profile_views').insert({
    tutor_id: tutorId,
    viewer_id: viewerId,
    viewer_role: viewerRole,
    search_subject: searchSubject,
    search_area: searchArea,
    search_city: searchCity,
    source: searchSubject || searchArea || searchCity ? 'search' : 'direct',
  })

  // PR106-E §7 — "1 parent viewed your profile" is only true for a PARENT viewer.
  // A view by another tutor, a staff account or an anonymous visitor still counts
  // as a profile_views row (the tutor's own stat) but must NOT send a made-up
  // "parent viewed" notification. Only parent/academy viewers notify.
  if (viewerRole === 'parent' || viewerRole === 'academy') {
    await notifyProfileViewed({
      admin,
      tutorId,
      subjectMasterId: searchSubject,
      area: searchArea,
      city: searchCity,
    })
  }
}

/**
 * Tell the tutor somebody looked — at most once a day.
 *
 * ONE A DAY, NOT ONE A VIEW. A parent comparing five tutors generates five
 * views in a minute, and a browsing session would otherwise arrive as a
 * notification storm about a fact the dashboard card already totals. The
 * throttle is a query for this tutor's most recent profile_viewed rather than
 * a stored timestamp: the notification IS the record, so there is nothing to
 * keep in step.
 *
 * IT NEVER NAMES THE VIEWER. Identity is what Premium sells and what
 * lib/profileViews withholds in server code; a notification that leaked a name
 * would hand it out through the back door. The body carries the search that
 * led here — the subject and the area — which is the useful half and is not
 * about the person.
 */
async function notifyProfileViewed(params: {
  admin: ReturnType<typeof createAdminClient>
  tutorId: string
  subjectMasterId: string | null
  area: string | null
  city: string | null
}) {
  const { admin, tutorId } = params
  if (!admin) return

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: recent } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', tutorId)
    .eq('kind', 'profile_viewed')
    .gt('created_at', dayAgo)
    .limit(1)
    .maybeSingle()
  if (recent) return

  let subject: string | null = null
  const masterId = Number(params.subjectMasterId)
  if (Number.isFinite(masterId) && masterId > 0) {
    const { data: m } = await admin
      .from('taxonomy_master')
      .select('level_slug, subject_slug')
      .eq('id', masterId)
      .maybeSingle()
    if (m) {
      const [{ data: level }, { data: sub }] = await Promise.all([
        admin.from('taxonomy_levels').select('name').eq('slug', m.level_slug).maybeSingle(),
        m.subject_slug
          ? admin.from('taxonomy_subjects').select('name').eq('slug', m.subject_slug).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const levelName = (level?.name as string) ?? ''
      const subjectName = (sub as { name?: string } | null)?.name ?? null
      subject = subjectName ? `${levelName} ${subjectName}`.trim() : levelName || null
    }
  }

  const where = params.area || params.city || null
  const detail =
    subject && where
      ? `Searching ${subject} in ${where}.`
      : subject
        ? `Searching ${subject}.`
        : where
          ? `A parent in ${where}.`
          : null

  await notify({
    userId: tutorId,
    kind: 'profile_viewed',
    title: '1 parent viewed your profile',
    body: detail,
    href: '/tutor/dashboard/views',
  })
}

