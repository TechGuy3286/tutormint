import type { Metadata } from 'next'
import { pageTitle } from '@/lib/seo'
import { getCompany } from '@/lib/company'
import Link from 'next/link'
import LegalDoc, { entitySection, type LegalSection } from '@/components/LegalDoc'

// Privacy Policy.
//
// DRAFT FOR OWNER REVIEW — not reviewed by a lawyer, and citing no statute by
// name. Pakistan's data protection legislation has been in draft for years;
// naming an act that may not be in force, or misdescribing one that is, would
// be worse than describing our actual practice plainly. A Pakistani lawyer
// should review this before launch.
//
// The commitments here are the ones the code keeps. Retention periods in
// section 6 are the ones we can actually honour today.

export const metadata: Metadata = {
  title: pageTitle('Privacy Policy'),
  description:
    'What TutorMint collects, who can see it, how CNICs and certificates are stored, how long we keep things, and how to get your data or have it deleted.',
}

const UPDATED = '1 September 2026'

const SECTIONS: LegalSection[] = [
  {
    id: 'summary',
    heading: 'The short version',
    body: (
      <>
        <ul>
          <li>
            <strong>We do not sell your data.</strong> Not to advertisers, not to anybody.
          </li>
          <li>
            <strong>Your CNIC is seen by you and by the staff who verify it.</strong> Never by
            another member.
          </li>
          <li>
            <strong>Your phone number is not on your public profile.</strong> It is shown only to
            members whose plan includes contact details, and only once you are working together.
          </li>
          <li>
            <strong>We do not read your messages</strong> — except a specific conversation that
            somebody has reported, in order to act on that report.
          </li>
          <li>
            <strong>You can ask for a copy of your data, or ask us to delete it.</strong>
          </li>
        </ul>
        <p>The rest of this page is the detail behind those five lines.</p>
      </>
    ),
  },
  {
    id: 'collect',
    heading: 'What we collect',
    body: (
      <>
        <p>
          <strong>Things you give us.</strong>
        </p>
        <ul>
          <li>Name, email address, mobile and WhatsApp number, city, area and address.</li>
          <li>
            Your role — tutor, parent, school or academy — and, for parents, the children you add
            (first name and class level only; we do not ask for a child’s CNIC, photograph, school
            or date of birth).
          </li>
          <li>
            For tutors: subjects, levels, qualifications, experience, fee, availability, profile
            photograph and an introduction video.
          </li>
          <li>
            Verification documents: CNIC number and image, and degree or qualification certificates.
          </li>
          <li>
            Everything you write: job posts, applications, messages, reviews, demo feedback and
            reports.
          </li>
          <li>
            Payment details you enter: the amount, method, reference and any receipt you upload.{' '}
            <strong>We never see or store your card number</strong> — that goes directly to the
            payment gateway.
          </li>
        </ul>
        <p>
          <strong>Things we record as you use the site.</strong> When you signed in, when your
          profile changed, when a job was posted or an application sent, that a message was sent (
          <strong>never what it said</strong>), which profiles were viewed, and what search filters
          were used. This is what lets us investigate a report, show a tutor that their profile is
          being seen, and count a monthly allowance honestly.
        </p>
        <p>
          <strong>Things your browser sends.</strong> IP address, device and browser type, and the
          pages you visit.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    heading: 'What we use it for',
    body: (
      <ul>
        <li>Running the platform — showing profiles and jobs, delivering messages, ranking search results.</li>
        <li>Verifying identities and qualifications, which is the entire basis of trust here.</li>
        <li>Taking payments, activating plans, and counting monthly allowances.</li>
        <li>
          Sending you emails about your account: verification decisions, being shortlisted or hired,
          payment receipts, and plan expiry. You can switch off the non-essential ones at{' '}
          <Link href="/account/notifications/settings">Notification settings</Link>.
        </li>
        <li>
          Investigating reports, preventing fraud and abuse, and deciding whether to warn or suspend
          an account.
        </li>
        <li>
          Promoting TutorMint using your public profile and photograph, as described in our{' '}
          <Link href="/terms">Terms</Link>. Tell us if you would rather we did not.
        </li>
        <li>Understanding, in aggregate, which parts of the site work and which do not.</li>
      </ul>
    ),
  },
  {
    id: 'who-sees',
    heading: 'Who can see what',
    body: (
      <>
        <p>
          <strong>Anyone on the internet</strong> sees a listed tutor’s public profile: name, photo,
          headline, biography, subjects, city and area, qualifications claimed, experience, fee,
          rating, reviews, and the introduction video if it has been approved for public viewing.
          Search engines index these pages — that is how families find tutors.
        </p>
        <p>
          <strong>Signed-in members</strong> additionally see job posts and can exchange messages
          with you.
        </p>
        <p>
          <strong>Members on a plan that includes contact details</strong> see your phone and
          WhatsApp number. On every other plan a number typed into a message is masked until both
          sides have that right.
        </p>
        <p>
          <strong>Nobody else, ever:</strong> your CNIC number and image, your home address, your
          original certificate files, your payment receipts, and the contents of your messages.
        </p>
        <p>
          <strong>TutorMint staff</strong> see what their role requires and no more. A verifier sees
          verification documents; a finance role sees payments; a support role sees reports. Every
          administrative action is recorded with who did it and when, in a log that cannot be edited
          or deleted.
        </p>
      </>
    ),
  },
  {
    id: 'messages',
    heading: 'Your messages',
    body: (
      <>
        <p>
          Messages are stored so that you and the person you are talking to can read them. Beyond
          that:
        </p>
        <ul>
          <li>
            <strong>There is no screen anywhere in TutorMint that lets staff browse conversations.</strong>{' '}
            It does not exist, deliberately.
          </li>
          <li>
            When somebody reports a conversation, moderators can read <strong>that</strong>{' '}
            conversation, because a report cannot be judged without the thing being reported.
          </li>
          <li>
            Our internal activity records note that a message was sent and in which conversation.
            They never contain the text.
          </li>
          <li>Message content is never included in an email notification.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'documents',
    heading: 'Documents: CNIC and certificates',
    body: (
      <>
        <p>
          Identity documents are held in a private storage area that has no public address. There is
          no URL that will return your CNIC image to somebody who has not been authorised, and one
          cannot be created by guessing.
        </p>
        <p>
          Degree certificates are shown to parents as a{' '}
          <strong>reduced-size copy with a TutorMint watermark</strong>. The original is never
          published.
        </p>
        <p>
          These measures stop casual copying. They cannot stop someone photographing their own
          screen, and we would rather say so than imply a protection that does not exist.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep things',
    body: (
      <>
        <ul>
          <li>
            <strong>Your account and profile:</strong> while your account is open.
          </li>
          <li>
            <strong>CNIC images and certificates:</strong> while your account is open. When you
            close your account we delete the image files, and keep only the fact that verification
            was approved or refused, and on what date.
          </li>
          <li>
            <strong>Messages, jobs, applications and reviews:</strong> kept after an account closes,
            with the closed member’s name removed, because the other person was part of that
            conversation too and it is their record as much as yours.
          </li>
          <li>
            <strong>Payment records:</strong> kept for seven years. These are accounting records and
            we are required to be able to produce them.
          </li>
          <li>
            <strong>Reports, suspensions and moderation decisions:</strong> kept after an account
            closes, so that somebody suspended for harming another member cannot simply return under
            a new email address.
          </li>
          <li>
            <strong>Activity and administrative logs:</strong> two years.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'sharing',
    heading: 'Who we share it with',
    body: (
      <>
        <p>
          <strong>We do not sell your personal data, and we never will.</strong> Advertisers on
          TutorMint buy a banner slot. They do not receive any information about who saw it beyond a
          count.
        </p>
        <p>We share data with the companies that run parts of the service for us:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — our database, authentication and file storage.
          </li>
          <li>
            <strong>Vercel</strong> — hosting.
          </li>
          <li>
            <strong>Our payment gateway and banking channels</strong> — to take payments. They
            handle card details; we do not.
          </li>
          <li>
            <strong>Resend</strong> — to deliver email.
          </li>
          <li>
            <strong>An SMS provider</strong> — to deliver one-time verification codes to your phone.
          </li>
          <li>
            <strong>YouTube</strong> — introduction videos are uploaded to our channel, privately
            until approved.
          </li>
        </ul>
        <p>
          Each of these receives only what it needs to do its job. We also disclose information where
          the law requires it, or where it is necessary to protect someone from serious harm.
        </p>
      </>
    ),
  },
  {
    id: 'where',
    heading: 'Where your data is held',
    body: (
      <p>
        Our database and files are hosted with Supabase, and our site with Vercel, on servers outside
        Pakistan. Some of the services listed above operate internationally. By using TutorMint you
        accept that your information is stored and processed outside Pakistan.
      </p>
    ),
  },
  {
    id: 'security',
    heading: 'How we protect it',
    body: (
      <>
        <ul>
          <li>Everything travels over an encrypted connection.</li>
          <li>Passwords are stored hashed. Nobody at TutorMint can read yours.</li>
          <li>
            The database enforces who can read what row by row, so a fault in a page cannot expose
            somebody else’s data.
          </li>
          <li>Private documents live in storage with no public address at all.</li>
          <li>
            Staff access is limited by role, every administrative action is logged, and destructive
            actions require the password to be entered again.
          </li>
        </ul>
        <p>
          No system is perfectly secure. If a breach ever affects your data, we will tell you what
          happened, what was involved, and what to do.
        </p>
      </>
    ),
  },
  {
    id: 'rights',
    heading: 'Your choices',
    body: (
      <>
        <ul>
          <li>
            <strong>See and correct your data</strong> — most of it is editable in your dashboard.
          </li>
          <li>
            <strong>Get a copy</strong> — ask us and we will send you what we hold.
          </li>
          <li>
            <strong>Delete your account</strong> — ask us. See section 6 for what is kept and why.
          </li>
          <li>
            <strong>Choose your emails</strong> — at{' '}
            <Link href="/account/notifications/settings">Notification settings</Link>. Emails about
            verification, payments, plan expiry and moderation are always sent; they are the ones
            you would be worse off missing.
          </li>
          <li>
            <strong>Withdraw permission to use your photograph</strong> in promotion, at any time,
            with no effect on your account.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies',
    body: (
      <>
        <p>
          We use cookies to keep you signed in and to keep the site secure. That is all they are for.
        </p>
        <p>
          We do not use advertising cookies, and we do not let third parties track you across other
          websites from here.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: 'Children',
    body: (
      <p>
        TutorMint accounts are for adults. A parent or guardian holds the account and may add a
        child’s first name and class level so that a tuition can describe who it is for. We do not
        collect a child’s CNIC, photograph, school, date of birth or contact details, and a child’s
        name is never shown on a public page.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        To ask what we hold, to correct something, to have your data deleted, or to raise a concern:{' '}
        <Link href="/support">contact us</Link>. We answer these ourselves — there is no form that
        goes nowhere.
      </p>
    ),
  },
]

export default async function PrivacyPage() {
  const company = await getCompany()

  // Inserted just before Contact rather than appended: a reader who scrolls to
  // the end for an address finds it next to the way to use it.
  const contactAt = SECTIONS.findIndex((s) => s.id === 'contact')
  const sections =
    contactAt === -1
      ? [...SECTIONS, entitySection(company)]
      : [...SECTIONS.slice(0, contactAt), entitySection(company), ...SECTIONS.slice(contactAt)]

  return (
    <LegalDoc
      title="Privacy Policy"
      updated={UPDATED}
      intro="What we collect, who can see it, and what you can do about it. Written to be read — the first section is the whole thing in five lines."
      sections={sections}
    />
  )
}
