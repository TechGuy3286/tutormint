// lib/notify/templates.ts
//
// Every email the platform sends, in one file, so "what do we send people and
// when" is a question with a single answer.
//
// Two rules run through all of them:
//
//   ESSENTIAL vs not. An essential email is one whose absence costs the member
//   something they cannot get back: a verification decision they are waiting
//   on, a payment receipt, a plan about to lapse, an account suspended. Those
//   ignore the opt-out flag. Everything else respects it. This distinction
//   lives on the template rather than at the call site, because a call site
//   that decides for itself is a call site that will one day decide wrong.
//
//   Plain text is written first and HTML wraps it. Pakistani inboxes are read
//   overwhelmingly on phones, often on patchy connections, and a text part that
//   reads properly on its own is worth more than a layout.
//
// No image is embedded and no tracking pixel is used.

export { SITE_URL } from '@/lib/siteUrl'
import { SITE_URL } from '@/lib/siteUrl'

export type TemplateId =
  | 'welcome'
  | 'verification_decision'
  | 'application_progress'
  | 'message_digest'
  | 'plan_activated'
  | 'plan_expiring'
  | 'plan_expired'

export type RenderedEmail = {
  subject: string
  text: string
  html: string
  /** Essential mail ignores profiles.email_opt_out. */
  essential: boolean
}

// ---------------------------------------------------------------- chrome --

function link(path: string): string {
  return path.startsWith('http') ? path : `${SITE_URL}${path}`
}

/**
 * Wrap a plain-text body in the house HTML. Inline styles only: Gmail strips
 * <style> blocks, and a stylesheet an inbox ignores is a layout that breaks
 * for the majority of readers.
 */
function shell(heading: string, paragraphs: string[], cta?: { label: string; href: string }): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(p)}</p>`,
    )
    .join('')

  const button = cta
    ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(link(cta.href))}" style="display:inline-block;background:#d60008;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;">${escapeHtml(cta.label)}</a></p>`
    : ''

  return `<div style="background:#F8FAFC;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;padding:28px 24px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:900;color:#0F172A;">Tutor<span style="color:#d60008;">Mint</span></p>
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:800;color:#0F172A;line-height:1.35;">${escapeHtml(heading)}</h1>
    ${body}
    ${button}
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">
    TutorMint · <a href="${escapeHtml(SITE_URL)}" style="color:#94a3b8;">tutormint.org</a><br />
    You can change which emails you receive at
    <a href="${escapeHtml(link('/account/notifications/settings'))}" style="color:#94a3b8;">Notification settings</a>.
  </p>
</div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function plain(heading: string, paragraphs: string[], cta?: { label: string; href: string }): string {
  const parts = [heading, '', ...paragraphs]
  if (cta) parts.push('', `${cta.label}: ${link(cta.href)}`)
  parts.push('', '—', 'TutorMint · tutormint.org', `Notification settings: ${link('/account/notifications/settings')}`)
  return parts.join('\n')
}

function build(
  subject: string,
  heading: string,
  paragraphs: string[],
  essential: boolean,
  cta?: { label: string; href: string },
): RenderedEmail {
  return {
    subject,
    text: plain(heading, paragraphs, cta),
    html: shell(heading, paragraphs, cta),
    essential,
  }
}

// -------------------------------------------------------------- templates --

export type TemplateInput =
  | { id: 'welcome'; name: string; role: 'tutor' | 'parent' | 'admin' | null }
  | {
      id: 'verification_decision'
      name: string
      decision: 'approved' | 'rejected' | 'hold'
      subjectOfDecision: 'profile' | 'video' | 'cnic'
      reason?: string | null
    }
  | {
      id: 'application_progress'
      name: string
      outcome: 'shortlisted' | 'hired'
      jobTitle: string
      href: string
    }
  | { id: 'message_digest'; name: string; count: number; from: string[] }
  | { id: 'plan_activated'; name: string; planName: string; expiresAt: string; amountPkr: number }
  | { id: 'plan_expiring'; name: string; planName: string; daysLeft: number }
  | { id: 'plan_expired'; name: string; planName: string }

export function render(input: TemplateInput): RenderedEmail {
  switch (input.id) {
    // ---------------------------------------------------------------------
    case 'welcome': {
      const next =
        input.role === 'tutor'
          ? 'Complete your profile to 100% and record your verification video — tutors only appear in search once their profile is complete.'
          : 'Verify your CNIC and address, then you can post a tuition and message tutors directly.'
      const cta =
        input.role === 'tutor'
          ? { label: 'Complete your profile', href: '/tutor/complete-profile' }
          : { label: 'Verify your account', href: '/parent/verify' }

      // Not essential: a welcome email is a courtesy. Anyone who opts out has
      // already signed up, so nothing is lost by not sending it.
      return build(
        'Welcome to TutorMint',
        `Welcome, ${input.name}`,
        ['Your TutorMint account is ready.', next, 'Browsing tutors and tuitions is free and always will be — you only need an account for the things that involve another person.'],
        false,
        cta,
      )
    }

    // ---------------------------------------------------------------------
    case 'verification_decision': {
      const what =
        input.subjectOfDecision === 'video'
          ? 'verification video'
          : input.subjectOfDecision === 'cnic'
            ? 'CNIC and address'
            : 'profile'

      if (input.decision === 'approved') {
        return build(
          `Your ${what} has been approved`,
          `Your ${what} is approved`,
          [
            `We have reviewed your ${what} and it has been approved.`,
            'Your Verified badge appears as soon as your profile reaches 100%.',
          ],
          true,
          { label: 'Open your dashboard', href: '/' },
        )
      }

      const verb = input.decision === 'hold' ? 'is on hold' : 'was not approved'
      return build(
        `Your ${what} ${verb}`,
        `Your ${what} ${verb}`,
        [
          `We have reviewed your ${what}.`,
          input.reason?.trim()
            ? `Reason given: ${input.reason.trim()}`
            : 'No reason was recorded. Please contact support and we will explain.',
          input.decision === 'hold'
            ? 'Nothing is lost — make the change and it goes back into the queue.'
            : 'You can correct this and submit again.',
        ],
        true,
        { label: 'Get help', href: '/support' },
      )
    }

    // ---------------------------------------------------------------------
    case 'application_progress': {
      const hired = input.outcome === 'hired'
      return build(
        hired ? `You have been hired — ${input.jobTitle}` : `You have been shortlisted — ${input.jobTitle}`,
        hired ? 'You have been hired' : 'You have been shortlisted',
        hired
          ? [
              `The parent who posted "${input.jobTitle}" has hired you.`,
              'Open the conversation to agree times and the first lesson.',
            ]
          : [
              `The parent who posted "${input.jobTitle}" has shortlisted your application.`,
              'They may message you next. Replying quickly makes a real difference.',
            ],
        // Essential: this is the outcome of something they applied for.
        true,
        { label: 'Open the job', href: input.href },
      )
    }

    // ---------------------------------------------------------------------
    case 'message_digest': {
      const who =
        input.from.length === 0
          ? ''
          : input.from.length === 1
            ? `From ${input.from[0]}.`
            : `From ${input.from.slice(0, 3).join(', ')}${input.from.length > 3 ? ' and others' : ''}.`

      // Not essential. This is the one people most reasonably want to switch
      // off, and it is throttled to one an hour on top of that.
      return build(
        input.count === 1 ? 'You have a new message on TutorMint' : `You have ${input.count} new messages on TutorMint`,
        input.count === 1 ? 'You have a new message' : `You have ${input.count} new messages`,
        [who, 'Message contents are not included in email. Open TutorMint to read and reply.'].filter(Boolean),
        false,
        { label: 'Open your messages', href: '/messages' },
      )
    }

    // ---------------------------------------------------------------------
    case 'plan_activated':
      return build(
        `Your ${input.planName} plan is active`,
        `Your ${input.planName} plan is active`,
        [
          `Payment of Rs. ${input.amountPkr.toLocaleString('en-PK')} received. Your plan runs until ${input.expiresAt}.`,
          'Memberships are non-refundable, as set out in our Terms.',
        ],
        true, // a receipt
        { label: 'View your plan', href: '/' },
      )

    // ---------------------------------------------------------------------
    // Worded as loss of VISIBILITY, not as an invoice (CLAUDE.md, conversion
    // rules item 7). "Your subscription is due" is a billing email and reads
    // as one; what actually matters to a tutor is that parents stop seeing
    // them above everyone else. The facts are identical -- the framing is the
    // part that decides whether it gets opened.
    case 'plan_expiring':
      return build(
        `You drop down the search results in ${input.daysLeft} days`,
        `Your visibility ends in ${input.daysLeft} days`,
        [
          `In ${input.daysLeft} days your ${input.planName} plan ends, and parents searching your subject in your city will start seeing other tutors above you.`,
          'Your badge comes off the same day. There is no grace period, and nothing is deleted: your conversations, applications and shortlists all stay exactly where they are.',
          'Renewing before then means your position never moves.',
        ],
        true, // billing
        { label: 'Keep my position', href: '/tutor/packages' },
      )

    // ---------------------------------------------------------------------
    case 'plan_expired':
      return build(
        'You have dropped below the tutors who are still Verified',
        'Your visibility has ended',
        [
          `Your ${input.planName} plan has ended, so parents searching your subject now see Verified tutors above you, and your badge is no longer shown.`,
          'Nothing has been deleted. Your conversations, applications, shortlists and posted jobs are all still in your dashboard.',
          'Starting a plan again puts you back where you were.',
        ],
        true, // billing
        { label: 'Get my position back', href: '/tutor/packages' },
      )
  }
}
