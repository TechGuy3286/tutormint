// lib/blogQueueDraft.ts
//
// Content queue → "Draft this post" (owner, 28 Oct 2026). Claude writes a draft
// blog post from a queued topic and it is saved as a DRAFT in Blog — never
// published, never reviewed, never approved. A person edits and publishes.
//
// The SAME machinery the editor's "Generate draft" runs: buildBlogBrief (the
// live facts sheet, the related landing pages and city job pages to link,
// every writing rule — no invented facts or figures, no prices, no
// superlatives, no promises), generateBlogOutline + generateBlogSection, then
// sanitizeDraft and the self-check loop. The draft gets a Live jobs block
// (lib/liveJobsCore) and meta lengths held to 60 / 155.
//
// Logged WITHOUT content: admin_audit_log 'blog.draft_from_queue' carries the
// model, word count, sections, links, timings and checker counts — never text.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import { clusterLabel, isClusterSlug } from '@/lib/blog'
import { buildBlogBrief, liveCheckerData } from '@/lib/blogGenerate'
import { generateBlogOutline, generateBlogSection, fixBlogPassages, BLOG_MODEL } from '@/lib/ai/blogCopy'
import { selfCorrect } from '@/lib/ai/selfCheck'
import { collectBlogProblems, sanitizeDraft } from '@/lib/ai/blogChecker'
import { wordCount } from '@/lib/ai/blogBrief'
import { internalLinksIn } from '@/lib/ai/platformFacts'
import { slugify } from '@/lib/slugs'
import { withLiveJobs } from '@/lib/liveJobsCore'
import { draftRow, fitMetaTitle } from '@/lib/blogQueueDraftCore'

export type QueueDraftResult =
  | { ok: true; postId: string; editorPath: string; words: number; title: string; seoTitle: string; seoDescription: string }
  | { ok: false; status: number; error: string }

type Actor = { id: string; adminRole: AdminRole; email: string | null }

export async function draftFromSuggestion(suggestionId: string, actor: Actor): Promise<QueueDraftResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: s } = await admin.from('content_suggestions').select('*').eq('id', suggestionId).maybeSingle()
  if (!s || s.card !== 'content') return { ok: false, status: 404, error: 'That topic is not in the queue.' }
  if (s.status === 'drafted' && s.drafted_post_id) {
    return { ok: false, status: 409, error: 'A draft already exists for this topic. Open it in Blog.' }
  }

  const key = (s.evidence_key ?? {}) as Record<string, unknown>
  const city = typeof key.city === 'string' && key.city ? (key.city as string) : null
  const subject = typeof key.subjectName === 'string' && key.subjectName ? (key.subjectName as string) : null
  const cluster = isClusterSlug(s.cluster as string) ? (s.cluster as string) : 'tutor-career'
  const audience = (['parents', 'tutors', 'both'].includes(s.audience as string) ? s.audience : 'tutors') as 'parents' | 'tutors' | 'both'
  const title = String(s.title ?? '').trim()
  const notes = String(s.notes ?? '')
  const female = Number(key.female ?? 0) === 1
  const online = Number(key.online ?? 0) === 1

  const t0 = Date.now()
  const brief = await buildBlogBrief({ title, clusterLabel: clusterLabel(cluster), audience, language: 'en', notes, city, subject })
  const outline = await generateBlogOutline(brief)
  if (!outline.ok) return { ok: false, status: 502, error: `Claude could not plan this post: ${outline.reason}` }
  // Sections in parallel: each is written from the same outline.
  const parts = await Promise.all(outline.sections.map((_, i) => generateBlogSection(brief, outline.sections, i)))
  const failed = parts.filter((p) => !p.ok).length
  const written = parts.flatMap((p) => (p.ok ? [p.markdown] : []))
  if (written.length === 0) return { ok: false, status: 502, error: 'Claude could not write this post. Please try again.' }

  const live = await liveCheckerData(null, { city, subject, title })
  const ctx = live.ctx
  const opts = {
    blogSlugs: ctx.publishedPostSlugs,
    audience,
    landingPaths: ctx.relatedLandingPaths ?? ctx.landingPaths,
    tutorSlugs: ctx.matchingTutorSlugs ?? ctx.tutorSlugs,
    blogTitles: live.blogTitles,
    tutorNames: live.tutorNames,
    cityJobPaths: ctx.cityJobPaths,
    noindexLinks: ctx.noindexLinks,
  }
  const corrected = await selfCorrect(
    { body: sanitizeDraft(written.join('\n\n'), opts), seoTitle: outline.seoTitle ?? '', seoDescription: outline.seoDescription ?? '' },
    {
      check: (d) => collectBlogProblems(d.body, { ...ctx, audience, seo: { title: d.seoTitle, description: d.seoDescription } }),
      fix: async (d, ps) => {
        const r = await fixBlogPassages(brief, { ...d, problems: ps.map((p) => ({ message: p.message, kind: p.kind, match: p.match, field: p.field })) })
        return r.ok ? r.edits : null
      },
      sanitize: (b) => sanitizeDraft(b, opts),
    },
  )
  const body = withLiveJobs(corrected.draft.body, female ? 'female' : online ? 'online' : null)
  const row = draftRow({
    title,
    cluster,
    audience,
    city,
    subject,
    body,
    seoTitle: corrected.draft.seoTitle,
    seoDescription: corrected.draft.seoDescription,
    notes,
  })

  const base = slugify(title) || 'draft'
  let slug = base
  for (let i = 2; i < 30; i++) {
    const { data: clash } = await admin.from('posts').select('id').eq('slug', slug).maybeSingle()
    if (!clash) break
    slug = `${base}-${i}`
  }
  const nowIso = new Date().toISOString()
  const { data: inserted, error } = await admin
    .from('posts')
    .insert({ ...row, slug, self_check: corrected.record, author_id: actor.id, suggestion_id: suggestionId, updated_at: nowIso })
    .select('id')
    .single()
  if (error || !inserted) return { ok: false, status: 500, error: 'The draft could not be saved. Please try again.' }
  const postId = inserted.id as string

  await admin
    .from('content_suggestions')
    .update({ status: 'drafted', drafted_post_id: postId, updated_at: nowIso })
    .eq('id', suggestionId)
    .in('status', ['suggested', 'snoozed', 'dismissed'])
  await admin.from('post_revisions').insert({
    post_id: postId,
    title: row.title,
    slug,
    cluster: row.cluster,
    audience: row.audience,
    language: row.language,
    body: row.body,
    seo_title: row.seo_title,
    seo_description: row.seo_description,
    source_notes: row.source_notes,
  })

  const words = wordCount(body)
  // Usage only — never any text of the post or the topic.
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'blog.draft_from_queue',
    targetType: 'post',
    targetId: postId,
    detail: {
      suggestionId,
      model: BLOG_MODEL,
      words,
      sections: written.length,
      sectionsFailed: failed,
      links: internalLinksIn(body).length,
      selfCheckRounds: corrected.record.rounds,
      problemsLeft: corrected.problems.length,
      ms: Date.now() - t0,
      status: 'draft',
    },
  }).catch(() => {})

  return { ok: true, postId, editorPath: `/admin/blog/${postId}`, words, title: row.title, seoTitle: row.seo_title ?? '', seoDescription: row.seo_description ?? '' }
}

export { fitMetaTitle }
