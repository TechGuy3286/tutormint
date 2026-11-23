import type { Metadata } from 'next'
import Link from 'next/link'
import { Mail, MapPin, MessageCircle, Star } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import { pageTitle } from '@/lib/seo'
import { getSupportContact, whatsappHref, formatSupportWhatsApp } from '@/lib/support'
import { PUBLIC_LOCATION, WORK_ONLINE_LINE, googleBusinessUrl, googleReviewUrl } from '@/lib/siteIdentity'
import { CONTACT_WHO } from '@/lib/contactFormCore'
import ContactForm from './ContactForm'

// /contact — "Contact us" (owner, 24 Nov 2026 — PR-20 Part A). WhatsApp, email,
// where we are (the city only — never a street address: we work online and do
// not receive visitors), the Google Business Profile, a line per kind of
// visitor on which button to use, and a short form that lands in the Team inbox.
// Static (cached for everyone); the form posts to /api/contact.

export const revalidate = 86400

export const metadata: Metadata = {
  title: pageTitle('Contact us'),
  alternates: { canonical: '/contact' },
  description: 'Contact the TutorMint team on WhatsApp or email, or send us a message. We work online from Lahore and reply to tutors, parents and academies.',
}

export default async function ContactPage() {
  const contact = await getSupportContact()
  const wa = whatsappHref(contact.whatsapp, 'Assalam-o-Alaikum, I have a question about TutorMint.')
  const btn = 'flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-colors'

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Contact us' }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">Contact us</h1>
        <p className="text-sm leading-relaxed text-slate-700">A person on the TutorMint team reads every message.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Ways to reach us">
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={`${btn} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}>
            <MessageCircle aria-hidden size={17} />
            WhatsApp {formatSupportWhatsApp(contact.whatsapp)}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className={`${btn} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}>
            <Mail aria-hidden size={17} />
            {contact.email}
          </a>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-700 sm:p-5">
        <p className="flex items-center gap-1.5 font-bold text-tm-navy">
          <MapPin aria-hidden size={16} /> {PUBLIC_LOCATION}
        </p>
        <p>{WORK_ONLINE_LINE}</p>
        {contact.hours && <p className="text-xs text-gray-600">{contact.hours}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={googleBusinessUrl()} target="_blank" rel="noopener noreferrer" className={`${btn} border border-gray-200 text-tm-navy hover:border-tm-navy`}>
            <MapPin aria-hidden size={15} />
            Find us on Google
          </a>
          <a href={googleReviewUrl()} target="_blank" rel="noopener noreferrer" className={`${btn} border border-gray-200 text-tm-navy hover:border-tm-navy`}>
            <Star aria-hidden size={15} />
            Leave us a review on Google
          </a>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="who-heading">
        <h2 id="who-heading" className="text-base font-black text-tm-navy">
          Which button to use
        </h2>
        <ul className="space-y-2">
          {CONTACT_WHO.map((w) => (
            <li key={w.who} className="rounded-2xl border border-gray-200 bg-white p-3 text-sm text-slate-700">
              <strong className="text-tm-navy">{w.who}:</strong> {w.line}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="form-heading">
        <h2 id="form-heading" className="text-base font-black text-tm-navy">
          Send us a message
        </h2>
        <ContactForm />
      </section>

      <p className="text-xs text-gray-600">
        Many answers are already in{' '}
        <Link href="/support" className="font-bold text-tm-red hover:underline">
          Help and support
        </Link>{' '}
        and the{' '}
        <Link href="/faq" className="font-bold text-tm-red hover:underline">
          FAQ
        </Link>
        .
      </p>
    </div>
  )
}
