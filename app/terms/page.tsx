import type { Metadata } from 'next'
import Link from 'next/link'
import LegalDoc, { type LegalSection } from '@/components/LegalDoc'

// Terms of Service.
//
// DRAFT FOR OWNER REVIEW — not reviewed by a lawyer. It is written to describe
// accurately what the platform actually does, in language a parent in Lahore
// can read, and it cites no statute: naming an ordinance we have not had
// checked would be worse than naming none, because it reads as authority the
// document does not have. A Pakistani lawyer should review it before launch,
// particularly sections 6 (payments), 11 (liability) and 13 (governing law).
//
// Every commitment below matches something the code actually enforces. Where
// the two ever disagree, the code is the bug.

export const metadata: Metadata = {
  title: 'Terms of Service | TutorMint',
  description:
    'The rules for using TutorMint: memberships and prices, the no-refund policy, quotas, verification, conduct, and how accounts are suspended.',
}

const UPDATED = '1 September 2026'

const SECTIONS: LegalSection[] = [
  {
    id: 'about',
    heading: 'Who we are and what TutorMint does',
    body: (
      <>
        <p>
          TutorMint (tutormint.org) is an online directory that connects tutors and teachers with
          parents, schools and academies in Pakistan. We are a place where the two sides find each
          other. We are not a party to whatever you agree between yourselves.
        </p>
        <p>
          <strong>We are not an employer, an agency, or a tuition centre.</strong> We do not set
          fees, supervise lessons, guarantee results, or take a commission on anything you earn or
          pay. The teaching relationship — its price, its schedule, its quality — is entirely
          between the tutor and the family.
        </p>
        <p>
          Using the site means you accept these terms. If you do not accept them, please do not use
          TutorMint.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: 'Your account',
    body: (
      <>
        <p>
          You must be 18 or over to hold an account. A parent or guardian may create an account on
          behalf of a student who is under 18; the adult holds the account and is responsible for it.
        </p>
        <ul>
          <li>Give us information that is true, and keep it up to date.</li>
          <li>
            One account per person. Do not create a second account to get around a suspension or a
            monthly allowance.
          </li>
          <li>
            Your password is yours to protect. Anything done from your account is treated as done by
            you.
          </li>
          <li>
            Do not sell, rent or share your account, and do not use somebody else’s.
          </li>
        </ul>
        <p>
          You can close your account at any time by asking us. See{' '}
          <Link href="/privacy">the Privacy Policy</Link> for what happens to your information
          afterwards.
        </p>
      </>
    ),
  },
  {
    id: 'verification',
    heading: 'Verification, and what a badge means',
    body: (
      <>
        <p>
          <strong>Tutors</strong> are verified by a person on our team, who reviews an introduction
          video, degree or qualification certificates, and CNIC. A tutor appears in the public
          directory once their profile is 100% complete and their account is in good standing.
        </p>
        <p>
          <strong>Parents, schools and academies</strong> are verified by CNIC and address. Posting
          a tuition requires that verification to have been approved — it is what protects tutors
          from fake postings.
        </p>
        <p>
          A video may be submitted at most three times. After a third unsuccessful review the upload
          is locked and you should contact support.
        </p>
        <p>
          <strong>What a badge does and does not mean.</strong> A Verified badge means we checked
          the documents that were given to us and they appeared genuine. It is not a guarantee of
          teaching ability, character, or that any particular claim is true. Documents can be
          forged, and identity checks have limits. Use your own judgement, meet in a sensible place,
          start with a demo class, and speak to previous families.
        </p>
      </>
    ),
  },
  {
    id: 'conduct',
    heading: 'How you must behave',
    body: (
      <>
        <p>Do not:</p>
        <ul>
          <li>impersonate another person, or claim qualifications you do not hold;</li>
          <li>post anything false, abusive, threatening, obscene, or discriminatory;</li>
          <li>
            harass anybody, contact them after they have asked you to stop, or use TutorMint to send
            unsolicited marketing;
          </li>
          <li>post a tuition you do not intend to fill, or apply to one you do not intend to teach;</li>
          <li>
            attempt to take a transaction off the platform in order to avoid a membership fee, or ask
            somebody else to;
          </li>
          <li>
            scrape, copy or systematically extract listings, profiles or contact details, by hand or
            by any automated means;
          </li>
          <li>
            attempt to break, overload, or gain unauthorised access to any part of the platform.
          </li>
        </ul>
        <p>
          <strong>Blocking and reporting.</strong> Any member may block any other member, which
          immediately stops messages and applications between them in both directions. Any member
          may report another member, a job post, or a conversation. When a conversation is reported,
          our moderators can read that conversation in order to act on the report. We do not
          otherwise read members’ messages, and there is no screen anywhere in TutorMint that lets
          staff browse conversations at will.
        </p>
      </>
    ),
  },
  {
    id: 'safety',
    heading: 'Meeting, lessons and your own safety',
    body: (
      <>
        <p>
          Lessons happen away from TutorMint, in a home, at an institute, or online. We are not
          present and we do not supervise them.
        </p>
        <ul>
          <li>Use the free demo class before committing to anything.</li>
          <li>
            For a first in-person meeting, choose somewhere sensible and let somebody know where you
            are going.
          </li>
          <li>
            For a child’s lesson, a parent or guardian should be present or nearby, whether the
            lesson is at home or online.
          </li>
          <li>
            Agree the fee, the schedule and the payment arrangement in writing before the first
            lesson.
          </li>
        </ul>
        <p>
          Money for lessons never passes through TutorMint. We cannot recover a fee, mediate a
          dispute about one, or refund it. If something serious happens, report it to us and to the
          police.
        </p>
      </>
    ),
  },
  {
    id: 'memberships',
    heading: 'Memberships, prices and quotas',
    body: (
      <>
        <p>
          The only thing TutorMint sells is a monthly membership. We charge no commission and no
          per-introduction fee.
        </p>
        <p>
          Current prices are shown on the packages pages and are stated in Pakistani Rupees. A
          membership runs for 30 days from activation.
        </p>
        <p>
          <strong>Quotas, including “Unlimited”.</strong> Every plan carries a monthly allowance of
          applications (tutors) or job posts (parents), counted per calendar month. Plans described
          as <strong>“Unlimited” are subject to a fair-use limit of 100 per month</strong>. We say
          so here, and on the packages page, because a limit you discover by hitting it is not a
          fair one. Fewer than one member in a hundred approaches it.
        </p>
        <p>
          <strong>Upgrading.</strong> Buying a different plan ends the current one immediately and
          starts a fresh full month. There is no proration and no credit for the part-month you
          leave behind.
        </p>
        <p>
          <strong>Expiry.</strong> We email you three days before your plan ends. On the day it
          ends, the plan’s features stop — there is no grace period. Nothing is deleted: your
          conversations, applications, shortlists, posted tuitions and reviews all remain in your
          account. A featured job stays open and simply loses its tag.
        </p>
        <p>
          We may change prices or what a plan includes. Changes apply to new purchases and renewals,
          never retroactively to a month you have already paid for.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    heading: 'Paying, and the no-refund policy',
    body: (
      <>
        <p>
          You can pay by card or wallet through our payment gateway, which activates the plan
          straight away, or by bank transfer, JazzCash or Easypaisa, which a member of our team
          confirms by hand — usually within a few hours. We never describe a manual transfer as
          instant.
        </p>
        <p>
          <strong>
            All membership payments are final. We do not give refunds, in whole or in part, for any
            reason.
          </strong>{' '}
          That includes an unused part of a month, a change of mind, a plan bought by mistake, a
          profile that does not attract enquiries, and an account suspended for breaking these
          terms. Please be sure before you pay; if you are unsure which plan you need, ask us first.
        </p>
        <p>
          The single exception is our own error — if we charge you twice for the same thing, or take
          a payment for something you did not buy, tell us and we will return it.
        </p>
        <p>
          <strong>A tutor may pay before their profile is complete.</strong> The plan starts
          immediately; the badge appears when the profile reaches 100% and verification passes.
          Paying does not shorten, replace or guarantee verification.
        </p>
      </>
    ),
  },
  {
    id: 'documents',
    heading: 'Documents, previews and copying',
    body: (
      <>
        <p>
          CNICs and identity documents are visible only to you and to the TutorMint staff who review
          verifications. They are stored in a private area that is not reachable from the public
          internet and are never shown to another member.
        </p>
        <p>
          Degree and qualification certificates are different: parents need to see that a
          qualification is real. What appears on your profile is a{' '}
          <strong>reduced-size copy with a TutorMint watermark across it</strong>. The original file
          is never published.
        </p>
        <p>
          We should be straightforward about the limit of this.{' '}
          <strong>
            These measures protect against casual copying. They cannot prevent somebody
            photographing or screenshotting their own screen
          </strong>{' '}
          — nothing on any website can. Upload only what you are willing for a prospective client to
          see.
        </p>
      </>
    ),
  },
  {
    id: 'content',
    heading: 'Your content, and using your photo to promote TutorMint',
    body: (
      <>
        <p>
          What you write and upload stays yours. By putting it on TutorMint you give us permission
          to store it and to display it on the platform so that the platform can work.
        </p>
        <p>
          <strong>Promotion.</strong> You also agree that we may use your{' '}
          <strong>profile photograph and the public details of your profile</strong> — your name,
          subjects, city, qualifications and rating — to promote TutorMint, including in posts on
          social media and in advertising. This never includes your phone number, email address,
          CNIC or home address, and it never includes anything from your private messages.
        </p>
        <p>
          If you would rather we did not use your photograph, tell us and we will stop. It has no
          effect on your account, your plan or your ranking.
        </p>
        <p>
          Reviews and demo feedback are the opinion of the person who wrote them. We do not edit
          them to be kinder. We remove ones that are abusive, obviously false, or written by someone
          who never met the tutor.
        </p>
      </>
    ),
  },
  {
    id: 'ranking',
    heading: 'Search results and advertising',
    body: (
      <>
        <p>
          Where a tutor appears in search results is decided by their plan tier first, then by how
          well they match what was searched for, their rating, and a small daily rotation so that
          equally-matched tutors share the top positions over time. Deliberately excluded: how
          recently somebody logged in, how many times their profile was viewed, and how much they
          message. None of those measure teaching.
        </p>
        <p>
          <strong>Advertisements are banners and nothing else.</strong> They are labelled
          “Sponsored”, they never appear as a tutor card, and buying one does not affect anybody’s
          position in search. Position is sold through plans, openly, and an advertiser cannot buy
          their way above a Featured tutor.
        </p>
      </>
    ),
  },
  {
    id: 'suspension',
    heading: 'Warnings, suspension and closing accounts',
    body: (
      <>
        <p>
          If you break these terms we may issue a written warning, suspend your account, or close it.
          What we do depends on what happened; a first misunderstanding is not treated like a
          deliberate fraud.
        </p>
        <p>
          <strong>A suspension stops everything at once:</strong> you cannot post, apply, message,
          hire or appear in search, and your badges are withdrawn. Nothing is deleted. Your jobs,
          applications, conversations, reviews and subscription all remain, and if the suspension is
          lifted your plan and badges come back as they were.
        </p>
        <p>
          <strong>A suspension does not entitle you to a refund</strong>, including for the unused
          part of a paid month.
        </p>
        <p>
          Every decision is recorded with a written reason, and we tell you what it was. If you
          think we have it wrong, reply and a different person will look again.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    heading: 'What we are and are not responsible for',
    body: (
      <>
        <p>
          TutorMint is provided as it is. We work hard to keep it accurate and available, but we do
          not promise it will be uninterrupted, error-free, or that every listing is correct.
        </p>
        <p>We are not responsible for:</p>
        <ul>
          <li>the conduct, honesty, ability or safety of any member, online or in person;</li>
          <li>the quality, timing or outcome of any lesson;</li>
          <li>any fee, payment or dispute between a tutor and a family;</li>
          <li>anything a member writes, uploads or claims about themselves;</li>
          <li>loss or damage arising from a meeting or arrangement made through the platform.</li>
        </ul>
        <p>
          Where we are liable to you despite the above, our total liability is limited to the amount
          you have paid us for membership in the twelve months before the claim. Nothing here limits
          liability that cannot be limited by law.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    body: (
      <>
        <p>
          We may update these terms. The date at the top always shows when they last changed. If a
          change materially affects you — the no-refund policy, quotas, or how we use your content —
          we will tell you by email before it takes effect.
        </p>
        <p>Continuing to use TutorMint after a change means you accept the updated terms.</p>
      </>
    ),
  },
  {
    id: 'law',
    heading: 'Governing law',
    body: (
      <>
        <p>
          These terms are governed by the laws of the Islamic Republic of Pakistan, and the courts of
          Pakistan have jurisdiction over any dispute arising from them.
        </p>
        <p>
          Please contact us first. Almost everything is resolved faster in a conversation than in a
          courtroom.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <>
        <p>
          Questions about these terms, a decision made about your account, or anything else:{' '}
          <Link href="/support">our support page</Link> has our WhatsApp number and email address,
          and a person reads what arrives there.
        </p>
      </>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      updated={UPDATED}
      intro="These are the rules for using TutorMint. We have tried to write them in plain language rather than in the usual wall of capital letters, because terms nobody reads protect nobody."
      sections={SECTIONS}
    />
  )
}
