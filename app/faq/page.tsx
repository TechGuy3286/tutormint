import Link from "next/link";

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
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 sm:px-12 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Pakistan</span>
        </Link>
        <div className="flex items-center space-x-3">
          <Link href="/parent/dashboard" className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xs font-bold rounded-xl transition-colors">
            Browse Tutors 🔍
          </Link>
          <Link href="/tutor/register" className="px-4 py-2 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl shadow-sm transition-colors">
            Tutor Sign Up 🚀
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 sm:py-16 space-y-8 flex-1 w-full">
        <div className="text-center space-y-3">
          <span className="bg-red-50 text-[#B3191F] px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider">Help Center</span>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Frequently Asked Questions</h1>
          <p className="text-xs sm:text-sm text-gray-500 max-w-lg mx-auto">Got questions about how TutorMint verifies educators and connects families? Find your answers below.</p>
        </div>

        <div className="space-y-4 pt-4">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
              <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <span className="text-[#B3191F]">Q:</span> {faq.q}
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed pl-5">
                {faq.a}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-gray-900 text-white p-8 rounded-3xl text-center space-y-4 mt-8">
          <h3 className="text-base font-black">Still have questions?</h3>
          <p className="text-xs text-gray-400 max-w-md mx-auto">Our support team is always ready to assist you via WhatsApp or our support portal.</p>
          <div className="flex justify-center gap-3">
            <Link href="/support" className="px-5 py-2.5 bg-[#B3191F] text-white text-xs font-bold rounded-xl hover:bg-[#9a151b] transition-colors">Visit Support Center</Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-5xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved. Verified Education Platform.</div>
        <div className="flex space-x-6 text-[11px]">
          <Link href="/faq" className="hover:text-gray-600 font-bold text-gray-700">FAQs</Link>
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600">Support</Link>
          <Link href="/about" className="hover:text-gray-600">About</Link>
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
        </div>
      </footer>
    </div>
  );
}