import { ListRowSkeletons } from '@/components/Skeletons'

// The inbox loading boundary (#102): conversation rows in the list's own shape
// while the threads load. No "Loading…" text.

export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
      <div className="rounded-2xl border border-gray-200 bg-white">
        <ListRowSkeletons count={6} />
      </div>
    </div>
  )
}
