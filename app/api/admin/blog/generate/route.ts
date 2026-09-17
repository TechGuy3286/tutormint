import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'
import { clusterLabel, isClusterSlug } from '@/lib/blog'
import { landingOptionsForEditor } from '@/lib/blogEditor'
import { publishedSlugs } from '@/lib/blogFeed'
import {
  generateBlogOutline,
  generateBlogSection,
  BLOG_MODEL,
  type BlogBrief,
} from '@/lib/ai/blogCopy'
import { listModels } from '@/lib/ai/anthropic'

// "Generate draft" — a blog body and its SEO fields, composed from the
// manager's title and fact notes, checked before it is handed back.
//
// OWNER + MANAGER ONLY (SCREEN_ACCESS.blogGenerate). Generation is the model
// speaking in our editorial voice and it costs money, so it sits with publish,
// not with drafting — support drafts by hand but does not generate.
//
// IT SAVES NOTHING AND PUBLISHES NOTHING. The draft lands in the editor as an
// ordinary editable body; the human gate is untouched (a saved human edit and a
// ticked review are still required to publish). What it does spend is money, so
// it has its own rate-limit bucket, and it is audited with the note size and
// the model — never the note text, which is the manager's working material.
//
// THE FIGURES ARE VERIFIED, not trusted: the returned body's numbers are
// checked against the notes and any that do not trace come back as `untraced`
// for the editor to flag. The same gate is enforced again on save.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A 900-1,400 word draft takes longer than the default function budget; the
// model call itself is capped at 55s (lib/ai/blogCopy.ts), so 60s leaves room
// for it to finish and fall back cleanly if it does not.
export const maxDuration = 60

// The generation is now a two-step, client-orchestrated background job (owner
// PR14 §1.5): step 'outline' (one short call) returns the section headings + SEO
// fields; step 'section' returns ONE section. No request writes 1200 words, so
// none can time out — and NOTHING is composed or inserted on failure (§1.2): a
// failure returns { ok: false, reason } and the editor keeps the notes.
const Body = z.object({
  step: z.enum(['outline', 'section']).default('outline'),
  title: z.string().trim().min(1, 'Give the post a title first.').max(200),
  cluster: z.string().refine(isClusterSlug, 'Choose a topic cluster.'),
  audience: z.enum(['parents', 'tutors', 'both']),
  language: z.enum(['en', 'ur']),
  notes: z.string().max(4000).default(''),
  // step 'section' only: the outline and which section to write.
  sections: z.array(z.string().max(300)).max(12).optional(),
  index: z.number().int().min(0).max(11).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blogGenerate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // PR16 §6.3 — give the model the LIVE set of things it may link to: the live
  // landing pages, /membership-plans and /faq, and recently published posts. Every
  // path here exists, so the 3-5 internal links it places resolve (the save gate
  // re-checks). Capped so the prompt stays bounded.
  const [landing, posts] = await Promise.all([landingOptionsForEditor(), publishedSlugs()])
  const linkOptions = [
    ...landing.map((l) => ({ label: l.label, path: l.path })),
    { label: 'Membership Plans (pricing)', path: 'membership-plans' },
    { label: 'Questions and answers (FAQ)', path: 'faq' },
    { label: 'Find tutors', path: 'browse/tutors' },
    { label: 'Find tuitions (post a job)', path: 'browse/tuitions' },
    ...posts.slice(0, 12).map((p) => ({
      label: `Blog: ${p.slug.replace(/-/g, ' ')}`,
      path: `blog/${p.slug}`,
    })),
  ]
  const brief: BlogBrief = {
    title: body.title,
    clusterLabel: clusterLabel(body.cluster),
    audience: body.audience,
    language: body.language,
    notes: body.notes,
    landingLinks: linkOptions,
  }

  // ------------------------------------------------------------- a section ---
  // No rate limit or audit per section — the outline step (once per generation)
  // carries both. Sections are bounded follow-ups of one generation event.
  if (body.step === 'section') {
    const res = await generateBlogSection(brief, body.sections ?? [], body.index ?? 0)
    if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason })
    return NextResponse.json({ ok: true, markdown: res.markdown })
  }

  // -------------------------------------------------------------- outline ----
  // Rate-limited (money is spent) and audited — the record of the generation.
  const limit = await rateLimit('ai_blog', gate.actor.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'drafts')

  const outline = await generateBlogOutline(brief)

  // Only on a real failure: ask which models the key can reach, to tell "wrong
  // model id" from "auth/billing/timeout".
  let availableModels: string[] | null = null
  let modelsReason: string | null = null
  if (!outline.ok) {
    const models = await listModels()
    if (models.ok) availableModels = models.ids
    else modelsReason = models.reason
  }

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'blog.generate',
    targetType: 'post',
    targetId: body.title.slice(0, 120),
    detail: {
      model: BLOG_MODEL,
      // The SIZE of the notes, never their text.
      noteChars: body.notes.trim().length,
      noteLines: body.notes.split('\n').filter((l) => l.trim()).length,
      // 'claude' on success, 'failed' on a real failure — no 'composed' path any
      // more (nothing is composed into the body on failure).
      source: outline.ok ? 'claude' : 'failed',
      note: outline.ok ? null : 'failed',
      reason: outline.ok ? null : outline.reason,
      availableModels,
      modelsReason,
      sectionCount: outline.ok ? outline.sections.length : 0,
      cluster: body.cluster,
      language: body.language,
    },
  })

  if (!outline.ok) {
    return NextResponse.json({ ok: false, reason: outline.reason, availableModels })
  }
  return NextResponse.json({
    ok: true,
    sections: outline.sections,
    seoTitle: outline.seoTitle,
    seoDescription: outline.seoDescription,
  })
}
