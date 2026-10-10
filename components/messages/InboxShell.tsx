import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Briefcase, MessagesSquare, ShieldCheck, Zap } from 'lucide-react'
import type { TeamRow } from '@/components/messages/ConversationList'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import Breadcrumbs from '@/components/Breadcrumbs'
import Conversation from '@/components/messages/Conversation'
import ConversationList from '@/components/messages/ConversationList'
import TeamPane from '@/components/messages/TeamPane'
import { getEntitlements } from '@/lib/entitlements'
import { messagePage, threadHeader, threadPage } from '@/lib/messaging'
import { loadTeamSummary } from '@/lib/adminMessaging'
import { mayAttachPhoto } from '@/lib/messagingRules'
import { createClient } from '@/lib/supabase/server'
import { formatName } from '@/lib/formatName'

// The inbox, both roles, one implementation.
//
// A parent's inbox and a tutor's inbox differ in four things: where the
// breadcrumb goes back to, what the empty state suggests doing next, the upsell
// reason a gated surface carries, and one notice a reply-only tutor sees. The
// masked-number and paperclip surfaces both open the upgrade sheet from that
// reason (contactReason) rather than linking to a packages page. Everything else
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

  // The official TutorMint Team conversation lives in this same inbox now
  // (owner, Part 5). `team` is a reserved thread id, not a `threads` row — it
  // opens the dedicated admin_messages store through TeamPane, which keeps the
  // "no chat-browsing screen" line true by construction.
  const isTeam = threadId === 'team'

  const supabase = await createClient()
  const [list, ent, { data: self }, teamSummary] = await Promise.all([
    threadPage({ userId, limit: LIST_PAGE }),
    getEntitlements(userId),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    loadTeamSummary(userId),
  ])
  const selfName = (formatName(self?.full_name as string | null) || 'You').split(' ')[0]
  const contactReason = role === 'tutor' ? 'tutor_contact' : 'parent_contact'
  // The official TutorMint Team conversation is a normal row in the list,
  // pinned first and counted like any other (owner, 6 Oct 2026). Rendered by the
  // list itself, UNDER the search bar, so the search is the first thing in the
  // pane. Only when the Team has written to this member.
  const teamRow: TeamRow | null = teamSummary.hasAny
    ? {
        href: `${basePath}/team`,
        active: isTeam,
        unread: teamSummary.unread,
        preview: teamSummary.lastBody || 'Official messages about your account',
      }
    : null

  const header = threadId && !isTeam ? await threadHeader(userId, threadId) : null

  // A thread that is not this member's, does not exist, or is between a
  // blocked pair all land here identically. `threadHeader` returns null for
  // every one of them on purpose: a 404 that distinguishes "not yours" from
  // "does not exist" is a way to enumerate conversations. `team` is exempt — it
  // is a reserved id resolved by TeamPane, not a threads row.
  if (threadId && !isTeam && !header) notFound()

  const history =
    header && (await messagePage({
      userId,
      threadId: header.id,
      limit: MESSAGE_PAGE,
      canShareContact: header.canShareContact,
    }))

  const selected = Boolean(header) || isTeam

  return (
    // PR74 §F: on mobile Messages starts right under the sticky header (pt-0);
    // desktop keeps sm:pt-2. The breadcrumb stays.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-3 pb-4 pt-0 sm:px-6 sm:pb-6 sm:pt-2 lg:px-8">
      {/* PR106-E §11 — on a phone the open conversation hides the breadcrumb; the
          chat header's ← is the one way back. Desktop (two-pane) keeps it. */}
      <div className={threadId ? 'hidden lg:block' : ''}>
      <Breadcrumbs
        items={
          isTeam
            ? [
                { label: dashboardLabel, href: dashboard },
                { label: 'Messages', href: basePath },
                { label: 'TutorMint Team' },
              ]
            : header
              ? [
                  { label: dashboardLabel, href: dashboard },
                  { label: 'Messages', href: basePath },
                  { label: header.otherName },
                ]
              : [{ label: dashboardLabel, href: dashboard }, { label: 'Messages' }]
        }
      />
      </div>

      {/* No "Messages" heading — the breadcrumb already says it, and dropping it
          lets the conversation start higher on phone and desktop (PR43 §4). */}
      {role === 'tutor' && !ent.canInitiateMessage && (
        <div className={`${threadId ? 'hidden lg:flex' : 'flex'} flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between`}>
          {ent.verified ? (
            <>
              <p className="text-[11px] leading-relaxed text-slate-700">
                You can reply to any parent who writes to you, and apply to tuitions. Premium lets you
                start a conversation yourself.
              </p>
              <Link
                href="/membership-plans?for=tutors&plan=premium"
                className="gap-1.5 inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
              >
                <Zap aria-hidden size={14} />
                See Premium
              </Link>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-slate-700">
                You can reply to any parent who writes to you. To apply to tuitions, get verified — then
                you are shown to parents in search.
              </p>
              <Link
                href="/tutor/complete-profile?step=verify"
                className="gap-1.5 inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
              >
                <ShieldCheck aria-hidden size={14} />
                Get verified
              </Link>
            </>
          )}
        </div>
      )}

      {/* The "Quick replies" block is gone from the inbox (owner, 6 Oct 2026). */}

      {/* PR106-E §10 — on a phone with a conversation open, the breadcrumb, the
          reply-only notice and the quick-reply editor above are hidden, so the
          chat takes nearly the whole viewport (just the site header above it).
          The message list inside scrolls independently and the composer stays
          pinned at the bottom (the Conversation flex column). */}
      <div
        className={`grid min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white lg:h-[calc(100dvh-16rem)] lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] ${
          threadId ? 'h-[calc(100dvh-5rem)]' : 'h-[calc(100dvh-15rem)]'
        }`}
      >
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
            teamRow={teamRow}
            emptyHint={
              role === 'tutor'
                ? ent.canInitiateMessage
                  ? 'Message a parent from one of their job posts, or wait for one to write to you.'
                  : ent.verified
                    ? 'Parents who message you first will appear here. You can also apply to tuitions that match your subjects.'
                    : 'Parents who message you first will appear here. Get verified so you can apply to tuitions and be shown to parents in search.'
                : 'Message any tutor from their profile, or from the applicants on one of your jobs.'
            }
            emptyActions={
              role === 'tutor'
                ? ent.verified
                  ? []
                  : [{ label: 'Get verified', href: '/tutor/complete-profile?step=verify' }]
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
          {isTeam ? (
            <TeamPane userId={userId} backPath={basePath} />
          ) : header && history ? (
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
                  gender={header.otherGender}
                  className="h-12 w-12 shrink-0 text-sm"
                  decorative
                />

                <div className="min-w-0 flex-1">
                  {/* PR106-D §3 — name + badges on ONE wrapping line. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-black text-tm-navy">
                    {header.otherSlug ? (
                      <Link href={`/tutor/${header.otherSlug}`} className="hover:underline">
                        {header.otherName}
                      </Link>
                    ) : (
                      <span>{header.otherName}</span>
                    )}
                    {header.otherBadges.length > 0 && <BadgeRow badges={header.otherBadges} size="sm" />}
                  </div>
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
              </div>

              <Conversation
                threadId={header.id}
                otherId={header.otherId}
                otherName={header.otherName}
                otherAvatar={header.otherAvatar}
                otherGender={header.otherGender}
                initial={history.items}
                initialCursor={history.cursor}
                canShareContact={header.canShareContact}
                suspended={ent.suspended}
                selfName={selfName}
                canAttach={mayAttachPhoto(ent)}
                contactReason={contactReason}
                quickReplies={[]}
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
