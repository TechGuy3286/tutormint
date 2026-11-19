// lib/interestInboxView.ts — one inbox row as the page shows it (PR-10). Used
// by People → WhatsApp updates → Parent interest and the parent member page's
// panel, so both render the same row from the same log. Dates are formatted
// here (Pakistan time); no phone leaves the server unmasked.

import { formatDateTime } from '@/lib/datetime'
import { pkDayStartMs } from '@/lib/tutorTeasersCore'
import { KIND_LABEL, type InboxActionView, type InboxRowView, type WaitReason } from '@/lib/interestInboxCore'
import type { InboxAction, InboxRow } from '@/lib/interestInbox'

const action = (a: InboxAction): InboxActionView => ({ label: KIND_LABEL[a.kind], at: a.at, when: formatDateTime(a.at), blocked: a.blocked })

export function inboxView(
  r: InboxRow & { mine?: InboxAction[]; inInbox?: boolean },
  actor: { id: string; adminRole: string | null },
  nowMs: number,
  waitLabel: (w: WaitReason) => string,
): InboxRowView {
  const today = !!r.last && Date.parse(r.last.at) >= pkDayStartMs(nowMs)
  return {
    tutorId: r.tutorId,
    name: r.name,
    city: r.city,
    paid: r.paid,
    assigneeName: r.assigneeName,
    tab: r.tab,
    waitLabel: r.wait ? waitLabel(r.wait) : null,
    summaryText: r.summaryText,
    lastActivityAt: r.summary.lastAt,
    message: r.message,
    weekCount: r.weekCount,
    last: r.last
      ? {
          id: r.last.id,
          by: r.last.by,
          when: formatDateTime(r.last.at),
          today,
          // undoWaSend's own rule: the sender or the Owner, the same day.
          mayUndo: r.last.staffId === actor.id || actor.adminRole === 'owner',
          from: r.last.from,
        }
      : null,
    parents: r.parents.map((p) => ({ parentId: p.parentId, name: p.name, maskedPhone: p.maskedPhone, place: p.place, actions: p.actions.map(action) })),
    ...(r.mine ? { mine: r.mine.map(action) } : {}),
    ...(r.inInbox === false ? { inInbox: false } : {}),
  }
}
