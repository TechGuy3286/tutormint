import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { roleMayWrite } from '@/lib/adminAccessCore'
import { listSuggestions, postsDueForRefresh } from '@/lib/contentQueue/feed'
import { loadSearchTopics } from '@/lib/contentQueue/searchTopicsServer'
import QueueClient, { type SearchTopicView } from '@/components/admin/blog/QueueClient'
import { createAdminClient } from '@/lib/supabase/admin'

// /admin/blog/queue — the content queue (CLAUDE.md 9.4; owner, 28 Oct 2026).
//
// Topics from REAL Google searches come first (Search Console API, or the
// owner's uploaded Queries CSV): tutor-side first, each with the queries behind
// it; a topic a page or post already answers says "Already covered by <page>".
// Then the other sources. No priority number anywhere. Nothing here publishes —
// "Draft this post" saves a DRAFT in Blog.

export const dynamic = 'force-dynamic'

export default async function ContentQueuePage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blogQueue)

  const [{ content, recruitment }, refresh, search] = await Promise.all([
    listSuggestions(),
    postsDueForRefresh(8),
    loadSearchTopics().catch(() => null),
  ])

  // The queue row behind each search topic (for Draft / Snooze / Dismiss).
  const admin = createAdminClient()
  const fps = (search?.topics ?? []).map((t) => t.fingerprint)
  const rows = new Map<string, { id: string; status: string; postId: string | null }>()
  if (admin && fps.length > 0) {
    const { data } = await admin.from('content_suggestions').select('id, fingerprint, status, drafted_post_id').in('fingerprint', fps)
    for (const r of data ?? []) rows.set(r.fingerprint as string, { id: r.id as string, status: r.status as string, postId: (r.drafted_post_id as string | null) ?? null })
  }
  const searchTopics: SearchTopicView[] = (search?.topics ?? []).map((t) => {
    const row = rows.get(t.fingerprint)
    return {
      fingerprint: t.fingerprint,
      title: t.title,
      side: t.side,
      impressions: t.impressions,
      clicks: t.clicks,
      queries: t.queries.slice(0, 10),
      coveredBy: t.coveredBy,
      suggestionId: row?.id ?? null,
      status: row?.status ?? null,
      draftPostId: row?.postId ?? null,
    }
  })
  const searchFps = new Set(fps)

  return (
    <QueueClient
      content={content.filter((s) => !searchFps.has(s.fingerprint ?? '') && s.source !== 'gsc')}
      recruitment={recruitment}
      refresh={refresh}
      searchTopics={searchTopics}
      searchSource={
        search
          ? {
              source: search.data.source,
              apiFetchedAt: search.data.api?.fetchedAt ?? null,
              uploadFetchedAt: search.data.upload?.fetchedAt ?? null,
              uploadRows: search.data.upload?.rows.length ?? 0,
              access: search.data.access,
            }
          : null
      }
      canDraft={roleMayWrite(actor.adminRole, SCREEN_ACCESS.blogQueueDraft)}
      canUpload={roleMayWrite(actor.adminRole, SCREEN_ACCESS.contentQueueUpload)}
    />
  )
}
