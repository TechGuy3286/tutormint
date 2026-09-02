import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { listThreads } from '@/lib/messaging'
import ThreadList from '@/components/ThreadList'

// Tutor conversations, on real data.
//
// A tutor on the Verified plan can reply to anything but cannot open a thread,
// so the notice says so once rather than letting them find out by pressing a
// button that refuses.

export const dynamic = 'force-dynamic'

export default async function TutorMessagesPage() {
  const session = await getSessionUser()
  const userId = session!.user.id

  const [threads, ent] = await Promise.all([listThreads(userId), getEntitlements(userId)])

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Messages' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Messages</h1>
        </header>

        {!ent.canInitiateMessage && (
          <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
            <Info size={14} className="mt-px shrink-0 text-gray-500" />
            Your plan lets you reply to any parent who writes to you, and apply for jobs.
            <Link href="/tutor/packages?plan=premium" className="font-bold text-tm-red underline">
              Premium
            </Link>{' '}
            lets you start a conversation yourself.
          </p>
        )}

        <ThreadList
          threads={threads}
          emptyHint={
            ent.canInitiateMessage
              ? 'Message a parent from one of their job posts, or wait for one to write to you.'
              : 'Parents who are interested will write to you here. Keep applying for jobs that match.'
          }
          emptyActions={[
            { label: 'Find tuitions to apply for', href: '/browse/tuitions' },
            { label: 'Check your profile is complete', href: '/tutor/complete-profile' },
          ]}
        />
      </div>
    </main>
  )
}
