// lib/notify/emailWording.ts
//
// The server half of the simple-English emails (owner, 28 Oct 2026). An email
// uses its APPROVED wording (email_wordings, written only by the Owner's
// approval in Team inbox → Templates → Review new wording) when there is one,
// and the built-in wording of lib/notify/templates.ts otherwise — so nothing
// changes until the Owner approves it.
//
// Read at most once a minute per server instance; a failed read means "no
// approved wording" (the built-in email is sent), never a failed email.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { pickEmail } from '@/lib/notify/emailPick'
import type { RenderedEmail, TemplateInput } from '@/lib/notify/templates'

type Stored = { subject: string; body: string }
let cache: { at: number; rows: Map<string, Stored>; support: string } | null = null
const TTL_MS = 60_000

/** Forget the cache (after an approval or a restore on this instance). */
export function clearEmailWordingCache(): void {
  cache = null
}

async function approved(): Promise<{ rows: Map<string, Stored>; support: string }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache
  const rows = new Map<string, Stored>()
  const admin = createAdminClient()
  if (admin) {
    try {
      const { data } = await admin.from('email_wordings').select('variant, subject, body')
      for (const r of data ?? []) rows.set(r.variant as string, { subject: r.subject as string, body: r.body as string })
    } catch {
      /* the built-in wording is used */
    }
  }
  const support = await loadSupportWhatsApp(admin).catch(() => '0321 5872222')
  cache = { at: Date.now(), rows, support }
  return cache
}

/** The email to send: the approved wording when there is one, else the built-in one. */
export async function renderEmail(input: TemplateInput): Promise<RenderedEmail> {
  const { rows, support } = await approved()
  return pickEmail(input, rows, support)
}
