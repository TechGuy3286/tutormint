import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import Link from "next/link";

export const metadata: Metadata = {
  title: 'Frequently asked questions | TutorMint',
  description:
    'How TutorMint verifies tutors, what memberships cost, why browsing is free, and how hiring works.',
}

export default function FAQPage() {
  const faqs = [
    {
      q: "How does TutorMint verify tutors?",
      a: "Every educator on TutorMint records a live 60-second video introduction holding their actual physical degree on camera. Our administrative team manually audits every single profile before approval to eliminate fake credentials."
    },
    {
      q: "How can parents/clients hire a tutor?",
      a: "Parents can browse verified tutors by city, view their ratings and credentials, and click 'Hire / Contact' to connect instantly via our matching and support team."
    },
    {
      q: "Is TutorMint free for parents to browse?",
      a: "Yes! Parents and clients can freely browse verified tutor profiles and compare ratings without any upfront login wall."
    },
    {
      q: "How can I register as a tutor?",
      a: "Tutors can click 'Tutor Sign Up' on the homepage, fill out their academic details, upload their verification proof, and get listed after admin review."
    },
    {
      q: "Which cities are covered by TutorMint?",
      a: "We currently operate actively in Lahore, Karachi, Islamabad, Multan, and surrounding regions across Pakistan."
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-tm-black flex flex-col justify-between">
      {/* The duplicate sticky wordmark bar is gone -- components/Navbar.tsx is
          the site header. Its two calls to action are kept, moved into the
          page, because /tutor/register is only still routed at all on the
          grounds that this page links to it. Browse Tutors pointed at
          /parent/dashboard, which is behind a login and is not where tutors
          are browsed. */}
      <main className="max-w-4xl mx-auto px-6 py-12 sm:py-16 space-y-8 flex-1 w-full">
        <Breadcrumbs items={[{ label: 'Help & FAQ' }]} />

        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/browse/tutors" className="inline-flex min-h-[44px] items-center rounded-xl bg-gray-100 px-4 text-xs font-bold text-gray-900 transition-colors hover:bg-gray-200">
            Browse tutors
          </Link>
          <Link href="/tutor/register" className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-tm-red-hover">
            Tutor sign up
          </Link>
        </div>

        <div className="text-center space-y-3">
          <span className="bg-tm-tint-red text-tm-red-hover px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider">Help Center</span>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Frequently Asked Questions</h1>
          <p className="text-xs sm:text-sm text-gray-500 max-w-lg mx-auto">Got questions about how TutorMint verifies educators and connects families? Find your answers below.</p>
        </div>

        <div className="space-y-4 pt-4">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
              <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <span className="text-tm-red-hover">Q:</span> {faq.q}
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed pl-5">
                {faq.a}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-gray-900 text-white p-8 rounded-3xl text-center space-y-4 mt-8">
          <h3 className="text-base font-black">Still have questions?</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">Our support team is always ready to assist you via WhatsApp or our support portal.</p>
          <div className="flex justify-center gap-3">
            <Link href="/support" className="px-5 py-2.5 bg-tm-red text-white text-xs font-bold rounded-xl hover:bg-tm-red-hover transition-colors">Visit Support Center</Link>
          </div>
        </div>
      </main>

      {/* Footer */}
    </div>
  );
}