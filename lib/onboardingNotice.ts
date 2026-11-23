import 'server-only'

// lib/onboardingNotice.ts — the "Continue onboarding (X of 16)" notification
// (PR-17 C.6, owner 23 Nov 2026).
//
// One notification per tutor, kept current: while onboarding is unfinished the
// tutor's bell holds ONE unread "Continue onboarding (9 of 16)" that opens the
// flow at the first unfinished step; its count is updated in place (never a
// second row); once onboarding is finished it is marked read. Synced from the
// tutor dashboard (a signed-in, per-request page) — never from a cached page.
// Nothing is deleted.

import { createAdminClient } from '@/lib/supabase/admin'
import type { RequiredItem } from '@/lib/profileRequired'
import { continueOnboardingLabel, nextItem, onboardingItemsDone } from '@/lib/onboarding/progressCore'
import { onboardingNoticeChange } from '@/lib/onboardingNoticeCore'

export const ONBOARDING_NOTICE_KIND = 'onboarding_continue'

export async function syncOnboardingNotice(userId: string, items: readonly RequiredItem[]): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data: rows } = await admin
      .from('notifications')
      .select('id, title, read_at')
      .eq('user_id', userId)
      .eq('kind', ONBOARDING_NOTICE_KIND)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(5)
    const done = items.filter((i) => i.done).length
    const next = nextItem(items)
    const change = onboardingNoticeChange({
      finished: onboardingItemsDone(items),
      title: continueOnboardingLabel(done, items.length),
      body: next && next.item.key !== 'verify' ? `Next: ${next.item.label}` : null,
      open: (rows ?? []).map((r) => ({ id: r.id as string, title: r.title as string })),
    })
    const now = new Date().toISOString()
    if (change.markRead.length > 0) await admin.from('notifications').update({ read_at: now }).in('id', change.markRead)
    if (change.update) await admin.from('notifications').update({ title: change.update.title, body: change.update.body }).eq('id', change.update.id)
    if (change.insert) {
      await admin.from('notifications').insert({
        user_id: userId,
        kind: ONBOARDING_NOTICE_KIND,
        title: change.insert.title,
        body: change.insert.body,
        href: '/tutor/complete-profile',
        meta: {},
      })
    }
  } catch {
    /* a bell line is a nudge, never a blocker */
  }
}
