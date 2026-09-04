import Breadcrumbs from '@/components/Breadcrumbs'
import { pageTitle } from '@/lib/seo'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Mail, MessageCircle } from 'lucide-react'
import { getSupportContact, whatsappHref } from '@/lib/support'
import FaqList, { type FaqGroup } from './FaqList'

// Support, FAQ-first.
//
// What was here before was a contact form that set a state variable and told
// the member "Your support ticket has been received" — nothing was sent, no
// ticket existed, and nobody was ever going to reply. Removing it is the single
// biggest improvement on this page.
//
// The shape is deliberate: most support contact is a question that has an
// answer, and the answer is faster to read than a reply is to wait for. So the
// answers come first, grouped by who is asking, and the ways to reach a person
// sit at the top for anyone who already knows their question is not on the
// list. Both routes are real — WhatsApp and email — and neither is shown at all
// unless it is configured.
//
// A server component: the FAQ text is part of the page for search engines, and
// only the accordion behaviour is client-side.

export const metadata: Metadata = {
  title: pageTitle('Help and support'),
  description:
    'Answers for tutors and parents on verification, packages, refunds, messaging and hiring — plus how to reach the TutorMint team on WhatsApp or email.',
}

const GROUPS: FaqGroup[] = [
  {
    id: 'everyone',
    title: 'Getting started',
    items: [
      {
        q: 'Does it cost anything to look for a tutor or a tuition?',
        a: 'No. Browsing tutors and tuitions is completely free and always will be, with no account needed. You only sign in when you want to do something that involves another person — apply to a tuition, post one, send a message, or see contact details.',
      },
      {
        q: 'Why do I have to sign in to send a message?',
        a: 'So that the person on the other side knows who they are talking to. Every account on TutorMint is a real, verified person, and that is only true if we know who is sending what.',
      },
      {
        q: 'I forgot my password.',
        a: 'Use "Sign in", then follow the reset link on the login page. If you signed up with your mobile number rather than an email address, message us on WhatsApp from that number and we will help.',
      },
    ],
  },
  {
    id: 'tutors',
    title: 'For tutors',
    items: [
      {
        q: 'How does verification work?',
        a: 'Three things: complete your profile to 100%, record a short introduction video, and upload your degree certificates and CNIC. Our team reviews the video and documents by hand. You get an email with the decision, and if something needs changing, the reason is in that email.',
      },
      {
        q: 'Why am I not showing up in search?',
        a: 'Tutors appear in the directory once their profile reaches 100% completion and their account is in good standing. Your dashboard shows exactly what is still missing. A paid plan is not required to be listed — it affects your ranking and what you can do, not whether you exist.',
      },
      {
        q: 'My video was rejected. What now?',
        a: 'The reason is on your dashboard and in the email we sent. You can record and submit a new one. There is a limit of three submissions in total; after the third, the upload button locks and you should contact us directly.',
      },
      {
        q: 'What does a package actually get me?',
        a: 'A higher position in search results, the badges on your profile, a larger monthly application allowance, and — on the top plan — the ability to see a parent’s contact details and message parents first. The exact table is on the packages page.',
      },
      {
        q: 'Can I pay before my profile is finished?',
        a: 'Yes. We will take the payment and your plan starts immediately, but the badge only appears once your profile reaches 100% and verification passes. Nothing is lost in the meantime.',
      },
    ],
  },
  {
    id: 'parents',
    title: 'For parents and schools',
    items: [
      {
        q: 'Why can I not post a tuition yet?',
        a: 'Posting requires a verified CNIC and address. It is the single thing that keeps fake and abusive job posts off the platform, and it is what tutors are relying on when they apply to yours. Upload both from your dashboard and our team reviews them by hand.',
      },
      {
        q: 'Why can I not hire the tutor I chose?',
        a: 'Completing a hire is a Featured plan feature. You can post tuitions, receive applications, message any tutor and request a free demo on the free verified plan; marking someone as hired, and seeing contact numbers, is on Featured.',
      },
      {
        q: 'Can I see a tutor’s phone number?',
        a: 'Only on the Featured plan. On every other plan you can message the tutor through the site, which reaches them just as quickly.',
      },
      {
        q: 'How do demo classes work?',
        a: 'Ask any tutor for a free demo, online or in person. They propose a time, you meet off the platform — Zoom, WhatsApp, or at home — and afterwards you leave feedback. One demo per tutor.',
      },
    ],
  },
  {
    id: 'money',
    title: 'Payments and refunds',
    items: [
      {
        q: 'Do you take a commission on my earnings or my fees?',
        a: 'No. TutorMint never takes a cut of what a tutor charges or a parent pays. The only thing we sell is a monthly membership. What you agree between yourselves is entirely yours.',
      },
      {
        q: 'Are memberships refundable?',
        a: 'No. All membership payments are final and non-refundable, including any unused part of a month. This is set out in our Terms, and it is stated on the packages page before you pay.',
      },
      {
        q: 'What does "Unlimited" mean on a plan?',
        a: 'It is subject to a fair-use limit of 100 applications or job posts a month. Almost nobody reaches it. We would rather tell you the number than let you find it.',
      },
      {
        q: 'I paid by bank transfer. When does my plan start?',
        a: 'Bank, JazzCash and Easypaisa transfers are confirmed by a person, usually within a few hours. Card payments through our gateway activate straight away. You will get an email either way.',
      },
      {
        q: 'What happens when my plan expires?',
        a: 'The plan features switch off on the day it ends — there is no grace period. Nothing is deleted: your conversations, applications, shortlists and posted tuitions all stay exactly where they are, and a featured job stays open, just without the tag. We email you three days before.',
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety and privacy',
    items: [
      {
        q: 'Someone is behaving badly. What do I do?',
        a: 'Use the Report button on their profile, on the job, or in the conversation. You can also block them, which stops all messages and applications between you both immediately. Reports go to a moderator who can see the reported conversation and can warn or suspend the account.',
      },
      {
        q: 'Who can see my CNIC?',
        a: 'Only you and the TutorMint staff who review verifications. It is stored in a private area that is not reachable from the public internet, and it is never shown to another member.',
      },
      {
        q: 'Who can see my degree certificates?',
        a: 'Parents see a watermarked, reduced-size preview on your profile — enough to see the qualification is real. The original file is never made public. Like anything on a screen it can be photographed, so the protection is against casual copying rather than a determined effort.',
      },
      {
        q: 'Will my photo be used in advertising?',
        a: 'Your profile photo and public profile details may be used to promote TutorMint, for example in a social media post about verified tutors. You agreed to this when you signed up, and it never includes your contact details. Ask us and we will stop using yours.',
      },
    ],
  },
]

export default async function SupportPage() {
  const contact = await getSupportContact()
  const wa = whatsappHref(contact.whatsapp, 'Hello TutorMint, I need help with ')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Help and support' }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">Help and support</h1>
        <p className="text-sm leading-relaxed text-slate-700">
          Most questions are answered below. If yours is not, message us — a person reads it.
        </p>
      </header>

      {(wa || contact.email) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-tm-green-deep px-4 py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-green-deep-hover"
            >
              <MessageCircle size={16} aria-hidden />
              Message us on WhatsApp
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <Mail size={16} aria-hidden />
              Email us
            </a>
          )}
        </section>
      )}

      {contact.hours && <p className="text-xs text-gray-500">{contact.hours}</p>}

      {!wa && !contact.email && (
        <p className="rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-xs leading-relaxed text-tm-gold-ink">
          Our contact details are being updated. In the meantime, the answers below cover almost
          everything.
        </p>
      )}

      <FaqList groups={GROUPS} />

      <footer className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs leading-relaxed text-gray-500">
          The full rules are in our{' '}
          <Link href="/terms" className="font-bold text-tm-red hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="font-bold text-tm-red hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </footer>
    </div>
  )
}
