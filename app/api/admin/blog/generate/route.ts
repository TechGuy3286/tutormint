import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'
import { clusterLabel, isClusterSlug } from '@/lib/blog'
import { landingOptionsForEditor } from '@/lib/blogEditor'
import { generateBlogDraft, BLOG_MODEL, type BlogBrief } from '@/lib/ai/blogCopy'
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

const Body = z.object({
  title: z.string().trim().min(1, 'Give the post a title first.').max(200),
  cluster: z.string().refine(isClusterSlug, 'Choose a topic cluster.'),
  audience: z.enum(['parents', 'tutors', 'both']),
  language: z.enum(['en', 'ur']),
  notes: z.string().max(4000).default(''),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blogGenerate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const limit = await rateLimit('ai_blog', gate.actor.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'drafts')

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // Only landing pages that exist may be linked — the same live set the editor
  // offers. The model is given these paths and told to invent no other link.
  const landing = await landingOptionsForEditor()

  const brief: BlogBrief = {
    title: body.title,
    clusterLabel: clusterLabel(body.cluster),
    audience: body.audience,
    language: body.language,
    notes: body.notes,
    landingLinks: landing.map((l) => ({ label: l.label, path: l.path })),
  }

  const draft = await generateBlogDraft(brief)

  // When the call to the model actually failed (not a missing key, not a
  // missing title), ask the API which models this key can reach. That is the
  // one fact that separates "wrong model id" from "auth/billing", and it turns
  // a mystery into a decision. Only on a real failure, so a healthy path costs
  // no extra round trip.
  let availableModels: string[] | null = null
  let modelsReason: string | null = null
  if (draft.source === 'composed' && draft.note === 'failed') {
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
    // No post exists yet — the draft is unsaved. The title identifies it.
    targetId: body.title.slice(0, 120),
    detail: {
      model: BLOG_MODEL,
      // The SIZE of the notes, never their text: the audit trail records that
      // a draft was generated from N characters of notes, not what they said.
      noteChars: body.notes.trim().length,
      noteLines: body.notes.split('\n').filter((l) => l.trim()).length,
      source: draft.source,
      note: draft.note ?? null,
      // The verbatim API failure (status + body), so the cause is on the record.
      reason: draft.reason ?? null,
      availableModels,
      modelsReason,
      untracedCount: draft.untraced.length,
      cluster: body.cluster,
      language: body.language,
    },
  })

  // `source`, `note` and `reason` are returned so the editor can say, in plain
  // words, exactly why it composed this one itself — a fallback presented as a
  // generation costs trust the first time the difference in tone is noticed.
  return NextResponse.json({
    body: draft.body,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    source: draft.source,
    note: draft.note ?? null,
    reason: draft.reason ?? null,
    availableModels,
    untraced: draft.untraced,
  })
}
