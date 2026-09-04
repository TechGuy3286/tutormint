import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z } from '@/lib/validate'
import { slugify } from '@/lib/slugs'
import {
  canPublish,
  isClusterSlug,
  postPath,
  SEO_TITLE_MAX,
  SEO_DESCRIPTION_MAX,
  type PublishGateInput,
} from '@/lib/blog'
import { slugTaken } from '@/lib/blogFeed'
import { revalidateBlog, notifySearchEngines } from '@/lib/blogPublish'

// Blog CMS mutations. Save + review is manager or support (support drafts);
// publish, schedule, unpublish and delete stop at manager.
//
// Writes go through the service role. Every SAVE also writes a post_revisions
// row (a fuller record than one audit line); publish/unpublish/schedule/delete
// additionally write admin_audit_log. Publishing is gated server-side by the
// same canPublish() the button reads — a human must have saved an edit and
// ticked reviewed, so the UI cannot be the only thing enforcing it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLUSTERS = z.string().refine(isClusterSlug, 'Choose a topic cluster.')

const SaveBody = z.object({
  action: z.literal('save'),
  id: z.string().optional(),
  title: z.string().trim().min(1, 'Give the post a title.').max(200),
  slug: z.string().trim().max(200).optional(),
  cluster: CLUSTERS,
  audience: z.enum(['parents', 'tutors', 'both']),
  language: z.enum(['en', 'ur']),
  body: z.string().max(100_000),
  coverPath: z.string().nullable().optional(),
  coverAlt: z.string().max(300).nullable().optional(),
  seoTitle: z.string().max(300).nullable().optional(),
  seoDescription: z.string().max(600).nullable().optional(),
  relatedLandingPages: z.array(z.string().max(200)).max(20).optional(),
  reviewed: z.boolean().optional(),
})

const IdBody = z.object({
  action: z.enum(['publish', 'unpublish', 'delete']),
  id: z.string().min(1),
})

const ScheduleBody = z.object({
  action: z.literal('schedule'),
  id: z.string().min(1),
  publishAt: z.string().min(1),
})

const Body = z.discriminatedUnion('action', [SaveBody, IdBody, ScheduleBody])

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function POST(request: Request) {
  // Any blog action needs at least draft access; publish-class actions re-check.
  const gate = await checkAdminRole(...SCREEN_ACCESS.blog)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // ------------------------------------------------------------- save ----
  if (body.action === 'save') {
    const existing = body.id
      ? (await admin.from('posts').select('*').eq('id', body.id).maybeSingle()).data
      : null
    if (body.id && !existing) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

    // Slug: locked once published. Otherwise derive from the title when blank,
    // and enforce shape + uniqueness.
    let slug: string = (existing?.slug as string) ?? ''
    if (!existing?.slug_locked) {
      slug = slugify(body.slug || body.title)
      if (!SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: 'The slug must be lowercase words separated by hyphens.', fields: { slug: 'Invalid slug.' } },
          { status: 400 },
        )
      }
      if (await slugTaken(slug, existing?.id as string | null)) {
        return NextResponse.json(
          { error: 'That slug is already used by another post.', fields: { slug: 'Already taken.' } },
          { status: 400 },
        )
      }
    }

    const reviewed = !!body.reviewed
    const nowIso = new Date().toISOString()

    // Status: a published/scheduled post stays as it is on an edit (the change
    // goes live / stays scheduled); a draft becomes 'reviewed' when the box is
    // ticked and 'draft' otherwise.
    const currentStatus = (existing?.status as string) ?? 'draft'
    const status =
      currentStatus === 'published' || currentStatus === 'scheduled'
        ? currentStatus
        : reviewed
          ? 'reviewed'
          : 'draft'

    const row = {
      title: body.title.trim(),
      slug,
      cluster: body.cluster,
      audience: body.audience,
      language: body.language,
      body: body.body,
      cover_path: body.coverPath ?? null,
      cover_alt: (body.coverAlt ?? '').trim() || null,
      seo_title: (body.seoTitle ?? '').trim().slice(0, SEO_TITLE_MAX) || null,
      seo_description: (body.seoDescription ?? '').trim().slice(0, SEO_DESCRIPTION_MAX) || null,
      related_landing_pages: body.relatedLandingPages ?? [],
      status,
      edited_by_human: true,
      reviewed,
      reviewed_by: reviewed ? gate.actor.id : null,
      updated_at: nowIso,
    }

    let postId = existing?.id as string | undefined
    if (existing) {
      const { error } = await admin.from('posts').update(row).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    } else {
      const { data, error } = await admin
        .from('posts')
        .insert({ ...row, author_id: gate.actor.id })
        .select('id')
        .single()
      if (error) {
        // A unique-violation on slug that slipped past the check above.
        const msg = /duplicate|unique/i.test(error.message) ? 'That slug is already used.' : error.message
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      postId = data.id as string
    }

    // A revision per save, so nothing is silently lost.
    await admin.from('post_revisions').insert({
      post_id: postId,
      title: row.title,
      slug: row.slug,
      cluster: row.cluster,
      audience: row.audience,
      language: row.language,
      body: row.body,
      cover_path: row.cover_path,
      cover_alt: row.cover_alt,
      seo_title: row.seo_title,
      seo_description: row.seo_description,
      related_landing_pages: row.related_landing_pages,
      status: row.status,
      editor_id: gate.actor.id,
    })

    // If it is already live, the edit is live too.
    if (status === 'published') revalidateBlog(slug)

    return NextResponse.json({ success: true, id: postId, slug, status })
  }

  // ---- publish-class actions: manager only, re-checked here ----
  const pub = await checkAdminRole(...SCREEN_ACCESS.blogPublish)
  if (!pub.ok) return NextResponse.json({ error: pub.error }, { status: pub.status })

  const { data: post } = await admin.from('posts').select('*').eq('id', body.id).maybeSingle()
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  const gateInput: PublishGateInput = {
    title: (post.title as string) ?? '',
    slug: (post.slug as string) ?? '',
    body: (post.body as string) ?? '',
    coverPath: (post.cover_path as string) ?? null,
    coverAlt: (post.cover_alt as string) ?? null,
    editedByHuman: !!post.edited_by_human,
    reviewed: !!post.reviewed,
  }

  const nowIso = new Date().toISOString()

  // ---------------------------------------------------------- publish ----
  if (body.action === 'publish') {
    const gateResult = canPublish(gateInput)
    if (!gateResult.ok) {
      return NextResponse.json({ error: gateResult.reasons[0], reasons: gateResult.reasons }, { status: 400 })
    }
    const { error } = await admin
      .from('posts')
      .update({
        status: 'published',
        published_at: (post.published_at as string) ?? nowIso,
        publish_at: null,
        slug_locked: true,
        updated_at: nowIso,
      })
      .eq('id', post.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: pub.actor.id,
      actorRole: pub.actor.adminRole,
      actorEmail: pub.actor.email,
      action: 'blog.publish',
      targetType: 'post',
      targetId: post.id as string,
      detail: { slug: post.slug, title: post.title },
    })
    revalidateBlog(post.slug as string)
    await notifySearchEngines(['/blog', postPath(post.slug as string)])
    return NextResponse.json({ success: true, status: 'published' })
  }

  // --------------------------------------------------------- schedule ----
  if (body.action === 'schedule') {
    const gateResult = canPublish(gateInput)
    if (!gateResult.ok) {
      return NextResponse.json({ error: gateResult.reasons[0], reasons: gateResult.reasons }, { status: 400 })
    }
    const when = new Date(body.publishAt)
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Pick a future date and time.' }, { status: 400 })
    }
    const { error } = await admin
      .from('posts')
      .update({ status: 'scheduled', publish_at: when.toISOString(), slug_locked: true, updated_at: nowIso })
      .eq('id', post.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: pub.actor.id,
      actorRole: pub.actor.adminRole,
      actorEmail: pub.actor.email,
      action: 'blog.schedule',
      targetType: 'post',
      targetId: post.id as string,
      detail: { slug: post.slug, publishAt: when.toISOString() },
    })
    return NextResponse.json({ success: true, status: 'scheduled', publishAt: when.toISOString() })
  }

  // -------------------------------------------------------- unpublish ----
  if (body.action === 'unpublish') {
    const { error } = await admin
      .from('posts')
      .update({ status: 'unpublished', updated_at: nowIso })
      .eq('id', post.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: pub.actor.id,
      actorRole: pub.actor.adminRole,
      actorEmail: pub.actor.email,
      action: 'blog.unpublish',
      targetType: 'post',
      targetId: post.id as string,
      detail: { slug: post.slug, title: post.title },
    })
    revalidateBlog(post.slug as string)
    await notifySearchEngines(['/blog'])
    return NextResponse.json({ success: true, status: 'unpublished' })
  }

  // ----------------------------------------------------------- delete ----
  const { error } = await admin.from('posts').delete().eq('id', post.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: pub.actor.id,
    actorRole: pub.actor.adminRole,
    actorEmail: pub.actor.email,
    action: 'blog.delete',
    targetType: 'post',
    targetId: post.id as string,
    detail: { slug: post.slug, title: post.title },
  })
  revalidateBlog(post.slug as string)
  return NextResponse.json({ success: true, deleted: true })
}
