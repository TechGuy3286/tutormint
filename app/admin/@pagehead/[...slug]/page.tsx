import Breadcrumbs from '@/components/Breadcrumbs'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { adminTrail } from '@/lib/adminNav'
import { createAdminClient } from '@/lib/supabase/admin'

// The page title and breadcrumb trail in the admin header.
//
// WHY A PARALLEL ROUTE. A layout is not re-rendered when you navigate between
// the routes it wraps, and Next gives it no way to ask which URL is showing --
// so a title derived in app/admin/layout.tsx would be correct on a hard load
// and then stick on the first screen for the rest of the session. A named slot
// with an optional catch-all is the piece designed for this: it matches
// /admin and every path under it, receives the segments as params, and
// re-renders on every navigation like any other page.
//
// THE LABEL IS LOOKED UP ON THE SERVER. /admin/jobs/<uuid> and
// /admin/users/<uuid> used to end their trail in a raw uuid -- noise on screen
// and useless as a way back. The last crumb now reads the job_tx_id (the
// string a parent quotes in a support message) or the member's name. It is one
// indexed lookup on two routes and nothing at all on the rest; there is no
// client fetch, because this is data the server already has.

export const dynamic = 'force-dynamic'

/** Which SCREEN_ACCESS entry may see the name behind an id on this path. */
const LABEL_SCREEN = {
  jobs: SCREEN_ACCESS.jobs,
  users: SCREEN_ACCESS.users,
} as const

async function dynamicLabel(slug: string[]): Promise<string | null> {
  const [section, id] = slug
  if (!id || slug.length !== 2) return null
  if (section !== 'jobs' && section !== 'users') return null

  // A finance admin who types a job URL is bounced by the page's own guard;
  // the trail must not leak the title on the way past.
  const actor = await getAdminActor()
  if (!actor || !roleSatisfies(actor.adminRole, LABEL_SCREEN[section])) return null

  const admin = createAdminClient()
  if (!admin) return null

  if (section === 'jobs') {
    const { data } = await admin.from('jobs').select('job_tx_id').eq('id', id).maybeSingle()
    return (data?.job_tx_id as string) ?? null
  }

  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return (data?.full_name as string) ?? null
}

export default async function AdminPageHead({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug = [] } = await params
  const label = await dynamicLabel(slug)
  const { crumbs, title } = adminTrail(['/admin', ...slug].join('/'), label)

  return (
    <div className="min-w-0">
      <Breadcrumbs items={crumbs} />
      <h1 className="-mt-2 truncate text-base font-black text-tm-navy sm:text-lg">{title}</h1>
    </div>
  )
}
