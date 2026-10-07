import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z } from '@/lib/validate'
import { clusterLabel, isClusterSlug } from '@/lib/blog'
import { buildBlogBrief, liveCheckerData } from '@/lib/blogGenerate'
import { generateBlogOutline, generateBlogSection, fixBlogPassages, BLOG_MODEL } from '@/lib/ai/blogCopy'
import { selfCorrect } from '@/lib/ai/selfCheck'
import { collectBlogProblems, sanitizeDraft } from '@/lib/ai/blogChecker'
import { wordCount, unsupportedFigures } from '@/lib/ai/blogBrief'
import { internalLinksIn, closingParagraph } from '@/lib/ai/platformFacts'
import { slugify } from '@/lib/slugs'

// POST /api/internal/blog-draft-test — the "Generate draft" end-to-end test
// harness (owner, 6 Oct 2026: "test first, on production, with a sample title").
//
// WHY A HARNESS. The admin "Generate draft" button is an admin-session route,
// and this environment has no browser and signs into no owner account. This
// route runs the IDENTICAL steps the editor runs — the same buildBlogBrief, the
// same generateBlogOutline / generateBlogSection, the same sanitizeDraft and
// collectBlogProblems — behind CRON_SECRET (lib/internalAuth), and on `save`
// writes ONE post as a DRAFT (status 'draft', not reviewed, not approved) so
// the result can be read in the editor. It can never publish anything.
//
//   { step: 'outline', title, cluster, audience, language, notes }
//   { step: 'section', ..., sections, index }
//   { step: 'save', title, cluster, audience, language, notes, sections, parts,
//     seoTitle, seoDescription }            → inserts the draft, returns stats
//
// Audited as 'blog.generate_test' under the owner account, with the harness
// named in the detail, so the audit log never reads as if the owner clicked.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  // 'check' runs the checker on any text and writes nothing; 'fix' returns the
  // writer's before/after edits for the given problems and writes nothing.
  step: z.enum(['outline', 'section', 'save', 'check', 'fix']),
  body: z.string().max(100_000).optional(),
  title: z.string().trim().min(1).max(200),
  cluster: z.string().refine(isClusterSlug, 'Choose a topic cluster.'),
  audience: z.enum(['parents', 'tutors', 'both']),
  language: z.enum(['en', 'ur']),
  notes: z.string().max(4000).default(''),
  sections: z.array(z.string().max(300)).max(12).optional(),
  index: z.number().int().min(0).max(11).optional(),
  parts: z.array(z.string().max(20000)).max(12).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
  problemIndex: z.number().int().min(0).max(50).optional(),
})

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const brief = await buildBlogBrief({
    title: body.title,
    clusterLabel: clusterLabel(body.cluster),
    audience: body.audience,
    language: body.language,
    notes: body.notes,
  })

  if (body.step === 'outline') {
    const t0 = Date.now()
    const outline = await generateBlogOutline(brief)
    const ms = Date.now() - t0
    if (!outline.ok) return NextResponse.json({ ok: false, step: 'outline', ms, reason: outline.reason, model: BLOG_MODEL })
    return NextResponse.json({ ok: true, step: 'outline', ms, model: BLOG_MODEL, sections: outline.sections, seoTitle: outline.seoTitle, seoDescription: outline.seoDescription, linkOptions: brief.landingLinks.length })
  }

  if (body.step === 'section') {
    const t0 = Date.now()
    const res = await generateBlogSection(brief, body.sections ?? [], body.index ?? 0)
    const ms = Date.now() - t0
    if (!res.ok) return NextResponse.json({ ok: false, step: 'section', index: body.index, ms, reason: res.reason })
    return NextResponse.json({ ok: true, step: 'section', index: body.index, ms, words: wordCount(res.markdown), markdown: res.markdown })
  }

  // ----------------------------------------------------------------- check ----
  if (body.step === 'check' || body.step === 'fix') {
    const live = await liveCheckerData(null)
    const text = body.body ?? ''
    const seo = { title: body.seoTitle ?? '', description: body.seoDescription ?? '' }
    const problems = collectBlogProblems(text, { ...live.ctx, audience: body.audience, seo })
    if (body.step === 'check') {
      return NextResponse.json({ ok: true, step: 'check', problems: problems.map((p) => ({ kind: p.kind ?? null, message: p.message, field: p.field ?? 'body' })) })
    }
    const pick = problems[body.problemIndex ?? 0]
    if (!pick) return NextResponse.json({ ok: false, reason: 'no such problem' })
    const res = await fixBlogPassages(brief, { body: text, seoTitle: seo.title, seoDescription: seo.description, problems: [pick] })
    return NextResponse.json({ ok: res.ok, step: 'fix', problem: pick.message, ...(res.ok ? { edits: res.edits } : { reason: res.reason }) })
  }

  // ------------------------------------------------------------------ save ----
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })
  const parts = body.parts ?? []
  if (parts.length === 0) return NextResponse.json({ error: 'No sections to save.' }, { status: 400 })

  const live = await liveCheckerData(null)
  const ctx = live.ctx
  const opts = {
    blogSlugs: ctx.publishedPostSlugs,
    audience: body.audience,
    landingPaths: ctx.landingPaths,
    tutorSlugs: ctx.tutorSlugs,
    blogTitles: live.blogTitles,
    tutorNames: live.tutorNames,
    cityJobPaths: ctx.cityJobPaths,
    noindexLinks: ctx.noindexLinks,
  }
  // The SAME self-correction loop the editor runs (lib/ai/selfCheck).
  const corrected = await selfCorrect(
    { body: sanitizeDraft(parts.join('\n\n'), opts), seoTitle: body.seoTitle ?? '', seoDescription: body.seoDescription ?? '' },
    {
      check: (d) =>
        collectBlogProblems(d.body, { ...ctx, audience: body.audience, seo: { title: d.seoTitle, description: d.seoDescription } }),
      fix: async (d, ps) => {
        const r = await fixBlogPassages(brief, {
          ...d,
          problems: ps.map((p) => ({ message: p.message, kind: p.kind, match: p.match, field: p.field })),
        })
        return r.ok ? r.edits : null
      },
      sanitize: (b) => sanitizeDraft(b, opts),
    },
  )
  const assembled = corrected.draft.body
  const problems = corrected.problems
  const words = wordCount(assembled)
  const links = internalLinksIn(assembled)
  const untraced = unsupportedFigures(assembled, body.notes, body.title, [], brief.landingLinks)

  // The owner account authors the test draft; the detail names the harness.
  const { data: owner } = await admin.from('profiles').select('id, email').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (!owner) return NextResponse.json({ error: 'No owner account found.' }, { status: 500 })

  const base = slugify(body.title) || 'test-draft'
  let slug = base
  for (let i = 2; i < 20; i++) {
    const { data: clash } = await admin.from('posts').select('id').eq('slug', slug).maybeSingle()
    if (!clash) break
    slug = `${base}-${i}`
  }
  const nowIso = new Date().toISOString()
  const { data: inserted, error } = await admin
    .from('posts')
    .insert({
      title: body.title,
      slug,
      cluster: body.cluster,
      audience: body.audience,
      language: body.language,
      body: assembled,
      seo_title: corrected.draft.seoTitle.slice(0, 60) || null,
      seo_description: corrected.draft.seoDescription.slice(0, 155) || null,
      self_check: corrected.record,
      source_notes: body.notes || null,
      status: 'draft',
      edited_by_human: false,
      reviewed: false,
      author_id: owner.id,
      updated_at: nowIso,
    })
    .select('id, slug')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: owner.id as string,
    actorRole: 'owner',
    actorEmail: (owner.email as string) ?? null,
    action: 'blog.generate_test',
    targetType: 'post',
    targetId: inserted.id as string,
    detail: {
      harness: 'internal /api/internal/blog-draft-test run at the owner\'s instruction (6 Oct 2026)',
      model: BLOG_MODEL,
      words,
      sections: parts.length,
      links: links.length,
      problems: problems.length,
      status: 'draft',
    },
  })

  return NextResponse.json({
    ok: true,
    step: 'save',
    postId: inserted.id,
    slug: inserted.slug,
    editorPath: `/admin/blog/${inserted.id}`,
    words,
    sections: parts.length,
    headings: (assembled.match(/^## .+$/gm) ?? []).map((h) => h.slice(3)),
    links,
    problems: problems.map((p) => p.message),
    untracedFigures: untraced,
    selfCheck: corrected.record,
    seoTitle: corrected.draft.seoTitle,
    seoDescription: corrected.draft.seoDescription,
    closing: closingParagraph(assembled),
  })
}
