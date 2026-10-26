import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import MergeClient from './MergeClient'

// Merge two accounts (owner, 26 Oct 2026; rules lib/memberMergeCore). The two
// accounts side by side (phone masked), the account to keep (the more complete
// one suggested), a preview of exactly what will move, then Merge — with the
// password asked again. Owner only; the server refuses everyone else.

export const dynamic = 'force-dynamic'

export default async function MergePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.memberMerge)
  const { a, b } = await searchParams
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-black text-tm-navy">Merge two accounts</h2>
        <p className="text-xs text-gray-500">
          Pick the account to keep. Nothing is deleted: the other account becomes “Merged into …”, is hidden from lists, search and the sitemap, and
          “Undo merge” puts everything back exactly.
        </p>
      </header>
      {!canApprove(actor.adminRole) ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Only the Owner can merge accounts.</p>
      ) : a && b ? (
        <MergeClient a={a} b={b} />
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Open a merge from a “Possible duplicate” line.</p>
      )}
    </div>
  )
}
