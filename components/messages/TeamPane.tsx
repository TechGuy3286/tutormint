import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

import EmptyState from '@/components/EmptyState'
import TeamReply from '@/components/messages/TeamReply'
import TeamMarkRead from '@/components/messages/TeamMarkRead'
import { loadConversation, TEAM_NAME } from '@/lib/adminMessaging'
import { formatDateTime } from '@/lib/datetime'

// The official TutorMint Team conversation, rendered inside the role inbox's
// right pane (owner, Part 5 — Team messages live here now, not on a separate
// /account/messages screen). System-styled: a navy shield header, the Team's
// 'out' messages on the left, the member's 'in' replies on the right. Reading it
// marks it read (TeamMarkRead); replying posts to /api/account/messages.

export default async function TeamPane({
  userId,
  backPath,
}: {
  userId: string
  backPath: string
}) {
  const messages = await loadConversation(userId)
  const unread = messages.filter((m) => m.direction === 'out' && !m.readAt).length

  return (
    <>
      <TeamMarkRead unread={unread} />
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5 sm:px-4">
        <Link
          href={backPath}
          aria-label="Back to conversations"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-tm-navy transition-colors hover:bg-gray-100 lg:hidden"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tm-navy text-white">
          <ShieldCheck aria-hidden size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-tm-navy">{TEAM_NAME}</p>
          <p className="truncate text-[11px] text-gray-500">Official messages about your account.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
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
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {m.body}
                    </p>
                    <p className="text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <TeamReply />
    </>
  )
}
