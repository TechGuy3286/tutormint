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
import { properName } from '@/lib/display'

export type TemplateId =
  | 'welcome'
  | 'verification_decision'
  | 'application_progress'
  | 'message_digest'
  | 'plan_activated'
  | 'plan_granted'
  | 'plan_expiring'
  | 'plan_expired'
  | 'account_banned'
  | 'verification_fee_paid'
  | 'content_digest'
  | 'admin_message'
  | 'staff_invite'
  | 'tuition_paused'

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

// The brand palette — the ONLY colours any email uses (owner, Part 7). No slate,
// no #0F172A, no #d60008. `FONT` is the one system stack, repeated inline because
// email clients strip <style>.
const RED = '#C20202'
const NAVY = '#151E6B'
const MINT_TINT = '#EEFBEE'
const INK = '#0A0A0A'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

/**
 * Wrap a plain-text body in the house HTML.
 *
 * TABLES + INLINE STYLES ONLY — no flexbox, no grid, no <style> block and no
 * external CSS: Gmail strips stylesheets, and Outlook ignores modern layout. A
 * `<meta name="color-scheme" content="light">` plus `bgcolor` on the coloured
 * cells is what stops Gmail's dark mode repainting the button and the ground.
 * The button is a full-width tap target. The wordmark is TEXT (no image), so no
 * blocked-image placeholder and nothing to fetch. Palette only (see above).
 */
/** A list of linked items (the welcome email's recent tuitions), rendered as a
 *  stack of full-width tappable cards — tables + inline styles, palette only. */
type EmailItems = { heading: string; items: { title: string; meta: string; href: string }[] }

function shell(
  heading: string,
  paragraphs: string[],
  cta?: { label: string; href: string },
  extra?: EmailItems,
  /** An ABSOLUTE one-click unsubscribe URL for this kind of email (PR54 §C).
   *  Passed pre-built, so it is used as-is (not run through link()). */
  unsubscribeHref?: string,
): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};font-family:${FONT};">${escapeHtml(p)}</p>`,
    )
    .join('')

  const items =
    extra && extra.items.length > 0
      ? `<p style="margin:20px 0 10px;font-family:${FONT};font-size:13px;font-weight:800;color:${NAVY};">${escapeHtml(extra.heading)}</p>` +
        extra.items
          .map(
            (it) =>
              `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td bgcolor="${MINT_TINT}" style="background:${MINT_TINT};border-radius:12px;padding:12px 14px;">
                <a href="${escapeHtml(link(it.href))}" style="text-decoration:none;font-family:${FONT};">
                  <span style="display:block;font-size:14px;font-weight:700;color:${NAVY};">${escapeHtml(it.title)}</span>
                  ${it.meta ? `<span style="display:block;margin-top:2px;font-size:12px;color:${INK};">${escapeHtml(it.meta)}</span>` : ''}
                </a>
              </td></tr></table>`,
          )
          .join('')
      : ''

  // Full-width button as its own table so the coloured cell carries bgcolor —
  // Gmail dark mode leaves a bgcolor cell alone but would recolour a styled <a>.
  const button = cta
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
        <tr><td bgcolor="${RED}" style="border-radius:12px;" align="center">
          <a href="${escapeHtml(link(cta.href))}" style="display:block;padding:14px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a>
        </td></tr>
      </table>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${MINT_TINT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MINT_TINT}" style="background:${MINT_TINT};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
      <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:20px;padding:28px 24px;">
        <p style="margin:0 0 20px;font-family:${FONT};font-size:20px;font-weight:900;color:${NAVY};">Tutor<span style="color:${RED};">Mint</span></p>
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:18px;font-weight:800;color:${NAVY};line-height:1.35;">${escapeHtml(heading)}</h1>
        ${body}
        ${items}
        ${button}
      </td></tr>
      <tr><td style="padding:16px 12px 0;">
        <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:${NAVY};text-align:center;">
          <a href="${escapeHtml(SITE_URL)}" style="color:${NAVY};text-decoration:none;font-weight:700;">tutormint.org</a><br />
          You can change which emails you receive at
          <a href="${escapeHtml(link('/account/notifications/settings'))}" style="color:${RED};">Notification settings</a>.<br />
          ${unsubscribeHref ? `<a href="${escapeHtml(unsubscribeHref)}" style="color:${RED};">Stop these tuition emails</a>.<br />` : ''}
          <span style="color:${NAVY};">© 2026 Tutor Mint (Private) Limited</span>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function plain(
  heading: string,
  paragraphs: string[],
  cta?: { label: string; href: string },
  extra?: EmailItems,
  unsubscribeHref?: string,
): string {
  const parts = [heading, '', ...paragraphs]
  if (extra && extra.items.length > 0) {
    parts.push('', `${extra.heading}:`)
    for (const it of extra.items) {
      parts.push(`• ${[it.title, it.meta].filter(Boolean).join(' — ')}: ${link(it.href)}`)
    }
  }
  if (cta) parts.push('', `${cta.label}: ${link(cta.href)}`)
  parts.push(
    '',
    '—',
    'TutorMint · tutormint.org',
    `Notification settings: ${link('/account/notifications/settings')}`,
  )
  if (unsubscribeHref) parts.push(`Stop these tuition emails: ${unsubscribeHref}`)
  parts.push('© 2026 Tutor Mint (Private) Limited')
  return parts.join('\n')
}

function build(
  subject: string,
  heading: string,
  paragraphs: string[],
  essential: boolean,
  cta?: { label: string; href: string },
  extra?: EmailItems,
  unsubscribeHref?: string,
): RenderedEmail {
  return {
    subject,
    text: plain(heading, paragraphs, cta, extra, unsubscribeHref),
    html: shell(heading, paragraphs, cta, extra, unsubscribeHref),
    essential,
  }
}

// -------------------------------------------------------------- templates --

export type TemplateInput =
  | {
      id: 'welcome'
      name: string
      role: 'tutor' | 'parent' | 'admin' | null
      /** Recent open tuitions for a tutor's welcome (PR29 §1.2), from a live
       *  query. Omitted / empty for parents and when nothing is open (§1.3). */
      tuitions?: { title: string; city: string; budget: string; href: string }[]
    }
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
      /** The job's human reference (TM-1001), shown so the tutor can quote it.
       *  Optional — omitted for a job with no ref (defensive; all have one). */
      ref?: string | null
      href: string
    }
  | { id: 'message_digest'; name: string; count: number; from: string[] }
  | { id: 'plan_activated'; name: string; planName: string; expiresAt: string; amountPkr: number }
  // The one-time Rs 199 verification fee receipt. A receipt, so essential; it
  // states visibility only — never a promise of being hired — and the no-refund
  // rule. No expiry: the fee is one-time, not a subscription.
  | { id: 'verification_fee_paid'; name: string; amountPkr: number }
  // An admin grant, not a purchase — so no amount and no refund line. Warm, and
  // it names what the plan unlocks without promising tuitions, income or a price.
  | { id: 'plan_granted'; name: string; planName: string; unlocks: string; listed: boolean }
  | { id: 'plan_expiring'; name: string; planName: string; daysLeft: number }
  | { id: 'plan_expired'; name: string; planName: string }
  // A ban has no in-app channel (the account cannot sign in), so email is the
  // only way to tell the member. Neutral, and points at support.
  | { id: 'account_banned'; name: string }
  | {
      id: 'content_digest'
      suggestions: { title: string; why: string; href: string }[]
      refresh: { title: string; href: string }[]
    }
  // An official message from the TutorMint Team, sent by an admin. Essential:
  // the admin chose to send it, and it is account/verification correspondence.
  | { id: 'admin_message'; body: string }
  // A staff invite / resend. Essential (it is the only way in), and it carries an
  // ABSOLUTE one-time link, so `link()` leaves it untouched.
  | { id: 'staff_invite'; name: string; role: string; url: string }
  | { id: 'tuition_paused'; title: string }
  // A tuition matching a Premium/Featured tutor's subjects (PR54 §C). Not
  // essential — it carries a one-click unsubscribe. NEVER a parent's name or
  // contact details, and no price.
  | {
      id: 'tuition_match'
      subject: string
      city: string
      area: string | null
      mode: string | null
      href: string
      /** Absolute one-click unsubscribe URL, built by the caller. */
      unsubscribeHref: string
    }

export function render(input: TemplateInput): RenderedEmail {
  switch (input.id) {
    // ---------------------------------------------------------------------
    case 'staff_invite': {
      // Says what to expect BEFORE the click: one link, straight to a
      // choose-your-password screen, then the admin panel. Essential — it is the
      // only route in — so it ignores the opt-out. Greets the RECIPIENT
      // (input.name is the invitee's name, passed by createStaff/resendStaffInvite),
      // never the owner who sent it. "as ${role}" was "as a operations"/"as a
      // admin" — both ungrammatical — so the role is a readable label with the
      // right article (owner PR12 §2.3).
      const roleName =
        input.role.toLowerCase() === 'admin'
          ? 'Admin'
          : input.role.toLowerCase() === 'operations'
            ? 'Operations team member'
            : input.role
      const asRole = /^[aeiou]/i.test(roleName) ? `an ${roleName}` : `a ${roleName}`
      return build(
        `You have been invited to the TutorMint team`,
        `You're invited to the TutorMint team`,
        [
          `Hi ${properName(input.name)}, you have been added to the TutorMint team as ${asRole}.`,
          'Click the button below to set your own password. The link is one-time and takes you straight to a screen where you choose a password — then you land in the admin panel with your role.',
          'If you were not expecting this, you can ignore this email and no account is activated.',
        ],
        true,
        { label: 'Set your password', href: input.url },
      )
    }

    // ---------------------------------------------------------------------
    case 'welcome': {
      const name = properName(input.name)
      const isTutor = input.role === 'tutor'
      // The verification-video line is removed for now (PR31 §6) — the YouTube
      // channel is unverified so uploads fail. Subjects, area and photo stay.
      const next = isTutor
        ? 'Complete your profile so parents can find you — add your subjects, area and a photo. Finishing your profile is what puts you in search and on Google.'
        : 'Verify your CNIC and address, then you can post a tuition and message tutors directly.'
      const cta = isTutor
        ? { label: 'Complete your profile', href: '/tutor/complete-profile' }
        : { label: 'Post a tuition', href: '/parent/dashboard/post-job' }

      // A tutor's welcome lists recent open tuitions (§1.2), from the live query
      // the caller ran; a parent's does not (§1.4). Left out entirely when
      // nothing is open (§1.3) — shell/plain render the section only when items
      // are present.
      const tuitions = isTutor ? (input.tuitions ?? []) : []
      const extra: EmailItems | undefined =
        tuitions.length > 0
          ? {
              heading: 'Tuitions posted recently',
              items: tuitions.map((t) => ({
                title: t.title,
                meta: [t.city, t.budget].filter(Boolean).join(' · '),
                href: t.href,
              })),
            }
          : undefined

      // Not essential: a welcome email is a courtesy. Anyone who opts out has
      // already signed up, so nothing is lost by not sending it.
      return build(
        'Welcome to TutorMint',
        `Welcome, ${name}`,
        [
          `Congratulations, ${name} — your TutorMint account is ready.`,
          next,
          'Browsing tutors and tuitions is free — you only need an account for the things that involve another person.',
        ],
        false,
        cta,
        extra,
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
            'Your Verified badge appears on your profile once everything it needs has been checked — your dashboard shows anything still outstanding.',
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
      // The reference is what the tutor quotes back over the phone or in a
      // message, so it rides the line that names the job.
      const jobLabel = input.ref ? `"${input.jobTitle}" (Ref ${input.ref})` : `"${input.jobTitle}"`
      return build(
        hired ? `You have been hired — ${input.jobTitle}` : `You have been shortlisted — ${input.jobTitle}`,
        hired ? 'You have been hired' : 'You have been shortlisted',
        hired
          ? [
              `The parent who posted ${jobLabel} has hired you.`,
              'Open the conversation to agree times and the first lesson.',
            ]
          : [
              `The parent who posted ${jobLabel} has shortlisted your application.`,
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
    case 'verification_fee_paid':
      return build(
        'You are verified on TutorMint',
        `You are verified, ${properName(input.name)}`,
        [
          `Payment of Rs. ${input.amountPkr.toLocaleString('en-PK')} received. Your one-time verification fee is paid and your profile is now shown to parents.`,
          'Complete your profile to appear higher in search. Verified tutors are shown to parents first.',
          'The verification fee is one-time and non-refundable, as set out in our Terms.',
        ],
        true, // a receipt
        { label: 'Open your dashboard', href: '/tutor/dashboard' },
      )

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
        { label: 'Keep my position', href: '/membership-plans?for=tutors' },
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
        { label: 'Get my position back', href: '/membership-plans?for=tutors' },
      )

    // ---------------------------------------------------------------------
    case 'tuition_paused':
      return build(
        'Your tuition is paused',
        'Your tuition is paused',
        [
          `Your tuition “${input.title}” has been paused automatically, 15 days after it was posted. Tutors can no longer see it in search or apply to it.`,
          'Nothing is lost — its applications, conversations and page all stay in your dashboard. Resume it to show it to tutors again for another 15 days.',
        ],
        true, // loss of visibility, like plan_expired — delivered regardless of opt-out
        { label: 'Resume your tuition', href: '/parent/dashboard/jobs' },
      )

    // ---------------------------------------------------------------------
    case 'tuition_match': {
      // Plain, simple English. Subject (which carries the grade/level), city,
      // area and mode; one button to the tuition page. NEVER a parent's name or
      // contact details, and no price. Not essential — a one-click unsubscribe
      // sits in the footer.
      const where = input.area ? `${input.area}, ${input.city}` : input.city
      return build(
        'A new tuition for you on TutorMint',
        'A new tuition matching your subjects',
        [
          `A parent has posted a new tuition that matches your subjects${input.mode ? ` (${input.mode})` : ''}.`,
          `Subject: ${input.subject}`,
          `Where: ${where}`,
          'Open it to see the full details and apply. Verified tutors are shown to parents first.',
        ],
        false,
        { label: 'View this tuition', href: input.href },
        undefined,
        input.unsubscribeHref,
      )
    }

    // ---------------------------------------------------------------------
    case 'plan_granted':
      return build(
        `Your ${input.planName} plan is active`,
        `Congratulations, ${properName(input.name)}`,
        [
          `Your ${input.planName} plan is now active on your TutorMint account.`,
          input.unlocks,
          input.listed
            ? ''
            : 'Your badge appears on your profile as soon as your identity and mobile number are verified.',
        ].filter(Boolean),
        true,
        { label: 'Open your dashboard', href: '/' },
      )

    // ---------------------------------------------------------------------
    case 'account_banned':
      return build(
        'Your TutorMint account has been closed',
        `Hello ${properName(input.name)}`,
        [
          'Your account has been banned due to fraudulent activities.',
          'If you believe this is a mistake, please contact support.',
        ],
        true,
        { label: 'Contact support', href: '/support' },
      )

    // The Monday content digest to owner + manager. An internal ops email, so
    // it is marked essential -- it should not be silenced by a member-facing
    // opt-out toggle. Nothing here auto-publishes; it points at the queue.
    case 'content_digest': {
      const lines: string[] = []
      if (input.suggestions.length > 0) {
        lines.push('Top topics to publish this week:')
        input.suggestions.forEach((sug, i) => lines.push(`${i + 1}. ${sug.title} — ${sug.why}`))
      } else {
        lines.push('No new topics are queued this week.')
      }
      if (input.refresh.length > 0) {
        lines.push('')
        lines.push('Posts due a refresh (published over a year ago):')
        input.refresh.forEach((r) => lines.push(`• ${r.title}`))
      }
      return build(
        'Your weekly content queue',
        'What to publish this week',
        lines,
        true, // internal ops
        { label: 'Open the content queue', href: '/admin/blog/queue' },
      )
    }

    // -------------------------------------------------------------------
    case 'admin_message': {
      // The body is written by an admin (from a template or by hand) and shown
      // verbatim. The member reads and replies in the app; the email is the
      // heads-up. Essential — the admin chose to send it.
      const paragraphs = input.body.split('\n').filter((p) => p.trim().length > 0)
      return build(
        'A message from the TutorMint Team',
        'A message from the TutorMint Team',
        paragraphs.length > 0 ? paragraphs : [input.body],
        true,
        { label: 'Open your messages', href: '/account/messages' },
      )
    }
  }
}
