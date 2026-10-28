import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadReviewBoard } from '@/lib/templateReview'
import ReviewClient from './ReviewClient'

// Team inbox → Templates → Review new wording (owner, 28 Oct 2026).
//
// Every member-facing template's LIVE wording beside its PROPOSED simple-English
// wording, with a preview filled with sample data. Nothing changes until the
// Owner approves: Approve, Edit then approve, Keep current, Approve all, and
// Restore from each template's history. The Partner views; nobody else opens it.

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Review new wording', robots: { index: false } }

export default async function ReviewWordingPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.templateReview)
  const board = await loadReviewBoard()
  return <ReviewClient board={board} canDecide={actor.adminRole === 'owner'} />
}
