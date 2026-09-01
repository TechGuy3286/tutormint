import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { listThreads } from '@/lib/messaging'
import ThreadList from '@/components/ThreadList'

// Parent conversations, on real data.
//
// The version this replaced rendered a hardcoded array of invented parents and
// message previews, so every parent saw the same three fictional conversations.

export const dynamic = 'force-dynamic'

export default async function ParentMessagesPage() {
  const session = await getSessionUser()
  const threads = await listThreads(session!.user.id)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <Link href="/parent/dashboard" className="text-xs font-bold text-tm-red hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Messages</h1>
        </header>

        <ThreadList
          threads={threads}
          emptyHint="Message any tutor from their profile, or from the applicants on one of your jobs."
          emptyActions={[
            { label: 'Find a tutor', href: '/browse/tutors' },
            { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
          ]}
        />
      </div>
    </main>
  )
}
