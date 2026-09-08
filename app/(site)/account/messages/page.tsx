import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import EmptyState from '@/components/EmptyState'
import { getSessionUser } from '@/lib/auth'
import { loadConversation, TEAM_NAME } from '@/lib/adminMessaging'
import { formatDateTime } from '@/lib/datetime'
import ReplyBox from './ReplyBox'

// The member's side of the official TutorMint Team conversation. The Team's
// messages ('out') sit on the left under the system name; the member's replies
// ('in') sit on the right. Replies land in /admin/inbox.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Messages from TutorMint | TutorMint',
  robots: { index: false, follow: false },
}

export default async function AccountMessagesPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login?next=/account/messages')

  const messages = await loadConversation(session.user.id)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs items={[{ label: 'Messages from TutorMint' }]} />
        <header className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tm-navy text-white">
            <ShieldCheck aria-hidden size={16} />
          </span>
          <div>
            <h1 className="text-lg font-black text-tm-navy">{TEAM_NAME}</h1>
            <p className="text-[11px] text-gray-500">Official messages about your account.</p>
          </div>
        </header>

        {messages.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck aria-hidden size={18} />}
            title="No messages yet. If our team needs to reach you about your account, it will appear here."
          />
        ) : (
          <ol className="space-y-2">
            {messages.map((m) => {
              const fromTeam = m.direction === 'out'
              return (
                <li key={m.id} className={`flex ${fromTeam ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] space-y-1 rounded-2xl px-4 py-2.5 ${
                      fromTeam
                        ? 'rounded-tl-sm border border-gray-200 bg-white'
                        : 'rounded-tr-sm bg-tm-tint-navy'
                    }`}
                  >
                    {fromTeam && (
                      <p className="text-[10px] font-black uppercase tracking-wide text-tm-navy">
                        {TEAM_NAME}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{m.body}</p>
                    <p className="text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {messages.length > 0 && <ReplyBox />}
      </div>
    </main>
  )
}
