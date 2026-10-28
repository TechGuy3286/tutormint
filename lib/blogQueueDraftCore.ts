// lib/blogQueueDraftCore.ts
//
// The rules of a content-queue draft (owner, 28 Oct 2026), pure for the tests:
// it is ALWAYS a draft (never published, never reviewed, never approved, no
// human edit yet), in English, with a meta title of at most 60 characters and a
// meta description of at most 155, cut at a word.

import { fitSeoDescription } from '@/lib/ai/blogBrief'

export const META_TITLE_MAX = 60
export const META_DESCRIPTION_MAX = 155

/** A meta title that fits 60 characters, cut at a word, never mid-word. */
export function fitMetaTitle(text: string, max = META_TITLE_MAX): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max + 1).replace(/\s+\S*$/, '')
  return cut.replace(/[,;:\s–—-]+$/, '').slice(0, max)
}

export type DraftInput = {
  title: string
  cluster: string
  audience: 'parents' | 'tutors' | 'both'
  city: string | null
  subject: string | null
  body: string
  seoTitle: string
  seoDescription: string
  notes: string
}

/** The posts row a queue draft is saved as. */
export function draftRow(d: DraftInput) {
  const seoTitle = fitMetaTitle(d.seoTitle.trim() || d.title)
  const desc = fitSeoDescription(d.seoDescription.trim(), META_DESCRIPTION_MAX)
  return {
    title: d.title.trim().slice(0, 200),
    cluster: d.cluster,
    audience: d.audience,
    language: 'en' as const,
    city: d.city,
    subject: d.subject,
    body: d.body,
    seo_title: seoTitle || null,
    seo_description: desc || null,
    source_notes: d.notes || null,
    status: 'draft' as const,
    edited_by_human: false,
    reviewed: false,
    approved_at: null,
    approved_by: null,
    numbers_checked: false,
    publish_at: null,
    published_at: null,
  }
}
