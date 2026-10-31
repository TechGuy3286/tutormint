import Breadcrumbs from '@/components/Breadcrumbs'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { adminTrail, type Crumb } from '@/lib/adminNav'
import { trailFor } from '@/lib/adminFromCore'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import { OVERVIEW_ITEMS, isOverviewItemKey } from '@/lib/overviewItemsCore'

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
  users: SCREEN_ACCESS.usersView,
  tutors: SCREEN_ACCESS.tutors,
  blog: SCREEN_ACCESS.blog,
  // A staff member's detail under Team activity (owner, 15 Oct 2026).
  'team-activity': SCREEN_ACCESS.staffActivity,
} as const

async function dynamicLabel(slug: string[]): Promise<string | null> {
  const [section, id] = slug
  if (!id || slug.length !== 2) return null
  // /admin/overview/<key>: the item's own title, from the pure list of items.
  if (section === 'overview') return isOverviewItemKey(id) ? OVERVIEW_ITEMS[id].title : null
  if (section !== 'jobs' && section !== 'users' && section !== 'tutors' && section !== 'blog' && section !== 'team-activity') {
    return null
  }

  // An admin without access who types a job URL is bounced by the page's own
  // guard; the trail must not leak the title on the way past.
  const actor = await getAdminActor()
  if (!actor || !roleSatisfies(actor.adminRole, LABEL_SCREEN[section])) return null

  const admin = createAdminClient()
  if (!admin) return null

  if (section === 'jobs') {
    const { data } = await admin.from('jobs').select('job_tx_id').eq('id', id).maybeSingle()
    return (data?.job_tx_id as string) ?? null
  }

  if (section === 'blog') {
    // 'new' is not an id; it resolves through SECTION_LABELS, not here. A real
    // id that does not parse as a uuid is left to fall back to a word.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { data } = await admin.from('posts').select('title').eq('id', id).maybeSingle()
    return (data?.title as string) ?? null
  }

  // 'claims' and 'accounts' are sections, not ids.
  if (section === 'team-activity' && !/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName(data?.full_name as string | null) || null
}

/**
 * The trail for one admin address. A record opened FROM a list carries the
 * list in `?from=` (lib/adminFromCore): the trail is then the list's own trail
 * (its crumb linking back to the list's full address, filter and search kept)
 * plus this record — up to FROM_MAX_DEPTH lists deep. With no `from` it is the
 * record's own section, e.g. "Admin › People › Name".
 */
function trailForUrl(url: string): Promise<Crumb[]> {
  return trailFor(url, async (path) => {
    const slug = path.split('/').filter(Boolean).slice(1)
    return adminTrail(path, await dynamicLabel(slug)).crumbs
  })
}

export default async function AdminPageHead({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug = [] } = await params
  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') query.set(k, v)
    else if (Array.isArray(v)) v.forEach((x) => query.append(k, x))
  }
  const path = ['/admin', ...slug].join('/')
  const qs = query.toString()
  const crumbs = await trailForUrl(qs ? `${path}?${qs}` : path)
  const title = crumbs[crumbs.length - 1].label

  return (
    <div className="min-w-0">
      {/* No "← Back to …" link: the trail is the only way back (owner, 20 Oct 2026). */}
      <Breadcrumbs items={crumbs} showBack={false} />
      <h1 className="-mt-2 truncate text-base font-black text-tm-navy sm:text-lg">{title}</h1>
    </div>
  )
}
