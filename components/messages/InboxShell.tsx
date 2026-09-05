import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Briefcase, MessagesSquare, Zap } from 'lucide-react'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import Breadcrumbs from '@/components/Breadcrumbs'
import Conversation from '@/components/messages/Conversation'
import ConversationList from '@/components/messages/ConversationList'
import { getEntitlements } from '@/lib/entitlements'
import { loadQuickReplies, messagePage, threadHeader, threadPage } from '@/lib/messaging'
import { mayAttachPhoto } from '@/lib/messagingRules'
import { createClient } from '@/lib/supabase/server'

// The inbox, both roles, one implementation.
//
// A parent's inbox and a tutor's inbox differ in four things: where the
// breadcrumb goes back to, what the empty state suggests doing next, where the
// upgrade link points, and one notice a reply-only tutor sees. Everything else
// -- the panes, the paging, the masking, the blocked and suspended states --
// is the same product, so it is the same code. Two copies would be two places
// for the masking rule to drift apart.
//
// BOTH PANES ARE SERVER-RENDERED. The list's first page and the conversation's
// newest window are in the HTML; the client components only append.
//
// ONE PANE AT A TIME BELOW lg, done with CSS rather than a media-query hook:
// which pane shows is decided by whether the URL names a thread, so it is
// already known on the server and there is nothing to flash.

const LIST_PAGE = 20
const MESSAGE_PAGE = 30

export default async function InboxShell({
  role,
  userId,
  threadId = null,
}: {
  role: 'parent' | 'tutor'
  userId: string
  threadId?: string | null
}) {
  const basePath = role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages'
  const dashboard = role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
  const dashboardLabel = role === 'tutor' ? 'Tutor dashboard' : 'Parent dashboard'
  const upgrade =
    role === 'tutor' ? '/tutor/packages?plan=featured' : '/parent/packages?plan=parent_featured'

  const supabase = await createClient()
  const [list, ent, { data: self }, quickReplies] = await Promise.all([
    threadPage({ userId, limit: LIST_PAGE }),
    getEntitlements(userId),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    role === 'tutor' ? loadQuickReplies(userId) : Promise.resolve([] as string[]),
  ])
  const selfName = ((self?.full_name as string | null) || 'You').split(' ')[0]
  const contactReason = role === 'tutor' ? 'tutor_contact' : 'parent_contact'

  const header = threadId ? await threadHeader(userId, threadId) : null

  // A thread that is not this member's, does not exist, or is between a
  // blocked pair all land here identically. `threadHeader` returns null for
  // every one of them on purpose: a 404 that distinguishes "not yours" from
  // "does not exist" is a way to enumerate conversations.
  if (threadId && !header) notFound()

  const history =
    header && (await messagePage({
      userId,
      threadId: header.id,
      limit: MESSAGE_PAGE,
      canShareContact: header.canShareContact,
    }))

  const selected = Boolean(header)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <Breadcrumbs
        items={
          header
            ? [
                { label: dashboardLabel, href: dashboard },
                { label: 'Messages', href: basePath },
                { label: header.otherName },
              ]
            : [{ label: dashboardLabel, href: dashboard }, { label: 'Messages' }]
        }
      />

      <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Messages</h1>

      {role === 'tutor' && !ent.canInitiateMessage && (
        <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-slate-700">
            Your plan lets you reply to any parent who writes to you, and apply for jobs. Premium
            lets you start a conversation yourself.
          </p>
          <Link
            href="/tutor/packages?plan=premium"
            className="gap-1.5 inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            <Zap aria-hidden size={14} />
            See Premium
          </Link>
        </div>
      )}

      <div className="grid h-[calc(100dvh-15rem)] min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white lg:h-[calc(100dvh-16rem)] lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Left: conversations. Hidden below lg once one is open — one pane at
            a time on a phone, and the conversation is the one being read. */}
        <aside
          aria-label="Conversations"
          className={`min-h-0 flex-col border-gray-200 lg:flex lg:border-r ${
            selected ? 'hidden' : 'flex'
          }`}
        >
          <ConversationList
            initial={list.items}
            initialCursor={list.cursor}
            basePath={basePath}
            activeId={header?.id ?? null}
            emptyHint={
              role === 'tutor'
                ? ent.canInitiateMessage
                  ? 'Message a parent from one of their job posts, or wait for one to write to you.'
                  : 'Parents who are interested will write to you here. Keep applying for jobs that match.'
                : 'Message any tutor from their profile, or from the applicants on one of your jobs.'
            }
            emptyActions={
              role === 'tutor'
                ? [
                    { label: 'Find tuitions to apply for', href: '/browse/tuitions' },
                    { label: 'Check your profile is complete', href: '/tutor/complete-profile' },
                  ]
                : [
                    { label: 'Find a tutor', href: '/browse/tutors' },
                    { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
                  ]
            }
          />
        </aside>

        {/* Right: the conversation, or the prompt to pick one. */}
        <section
          aria-label="Conversation"
          className={`min-h-0 flex-col lg:flex ${selected ? 'flex' : 'hidden'}`}
        >
          {header && history ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5 sm:px-4">
                {/* The way back on a phone. Below lg the list is not on
                    screen, so without this the only way out of a conversation
                    is the browser's own back button. */}
                <Link
                  href={basePath}
                  aria-label="Back to conversations"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-tm-navy transition-colors hover:bg-gray-100 lg:hidden"
                >
                  <ArrowLeft size={18} aria-hidden />
                </Link>

                {/* Larger than the ones beside the bubbles: this is the
                    header's subject, and it is what a reader glances at to
                    confirm whose conversation is open. */}
                <Avatar
                  name={header.otherName}
                  src={header.otherAvatar}
                  seed={header.otherId}
                  className="h-12 w-12 shrink-0 text-sm"
                  decorative
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-tm-navy">
                    {header.otherSlug ? (
                      <Link href={`/tutor/${header.otherSlug}`} className="hover:underline">
                        {header.otherName}
                      </Link>
                    ) : (
                      header.otherName
                    )}
                  </p>
                  {header.jobTitle && (
                    <p className="flex items-center gap-1 truncate text-[11px] text-gray-500">
                      <Briefcase size={11} className="shrink-0" aria-hidden />
                      {(role === 'tutor' ? header.jobHref : header.jobRef) ? (
                        <Link
                          href={
                            // A tutor does not own the job, so their link is
                            // the tuition's own public page; the parent's is
                            // their management page for it. A tutor gets no
                            // link once the tuition closes -- that URL answers
                            // 410, and a conversation about a filled tuition
                            // is exactly where somebody would click it.
                            role === 'tutor'
                              ? (header.jobHref as string)
                              : `/parent/dashboard/job/${header.jobRef}`
                          }
                          className="truncate hover:underline"
                        >
                          {header.jobTitle}
                        </Link>
                      ) : (
                        <span className="truncate">{header.jobTitle}</span>
                      )}
                    </p>
                  )}
                </div>

                {header.otherBadges.length > 0 && (
                  <BadgeRow badges={header.otherBadges} size="sm" />
                )}
              </div>

              <Conversation
                threadId={header.id}
                otherId={header.otherId}
                otherName={header.otherName}
                otherAvatar={header.otherAvatar}
                initial={history.items}
                initialCursor={history.cursor}
                canShareContact={header.canShareContact}
                suspended={ent.suspended}
                upgradeHref={upgrade}
                selfName={selfName}
                canAttach={mayAttachPhoto(ent)}
                contactReason={contactReason}
                quickReplies={quickReplies}
              />
            </>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-2 p-8 text-center lg:flex">
              <MessagesSquare size={22} className="text-gray-300" aria-hidden />
              <p className="text-xs font-bold text-tm-navy">Pick a conversation</p>
              <p className="max-w-xs text-[11px] leading-relaxed text-gray-500">
                Choose someone on the left to read the whole conversation and reply.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
