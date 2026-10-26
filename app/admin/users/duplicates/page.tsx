import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadOpenDuplicatePairs } from '@/lib/memberDuplicates'
import { DUP_WORDS } from '@/lib/peopleDirectoryCore'
import DuplicateActions from '@/components/admin/DuplicateActions'

// People → Possible duplicates (owner, 26 Oct 2026): every open pair (the People
// cards' own rule, minus the pairs marked "Not a duplicate"), each with Merge
// and Not a duplicate. Owner only acts; the Partner views.

export const dynamic = 'force-dynamic'

export default async function DuplicatesPage() {
  await requireAdminRole(...SCREEN_ACCESS.memberMerge)
  const pairs = await loadOpenDuplicatePairs()
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-black text-tm-navy">Possible duplicates</h2>
        <p className="text-xs text-gray-500">
          {pairs.length} open {pairs.length === 1 ? 'pair' : 'pairs'}: the same mobile, the same CNIC, or a very similar name in the same city.
        </p>
      </header>
      {pairs.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">No open pairs.</p>
      ) : (
        <ul className="space-y-2" data-duplicate-pairs="">
          {pairs.map((p) => (
            <li key={`${p.aId}|${p.bId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs">
              <span>
                <Link href={`/admin/users/${p.aId}`} className="font-black text-tm-navy hover:underline">
                  {p.aName}
                </Link>
                {' and '}
                <Link href={`/admin/users/${p.bId}`} className="font-black text-tm-navy hover:underline">
                  {p.bName}
                </Link>
                <span className="text-gray-500">
                  {' '}
                  · {p.role === 'tutor' ? 'tutors' : 'parents'} · {DUP_WORDS[p.reason]}
                </span>
              </span>
              <DuplicateActions aId={p.aId} bId={p.bId} reason={p.reason} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
