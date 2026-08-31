import Link from "next/link";

export default function FAQsPage() {
  const faqs = [
    {
      q: "Why is TutorMint 0% commission?",
      a: "Traditional agencies take heavy recurring cuts from tutors' hard-earned money. TutorMint believes educators should keep 100% of their earnings. We provide a direct platform connecting parents and tutors without any middle-man fees."
    },
    {
      q: "How does the tutor verification process work?",
      a: "Every tutor on TutorMint goes through a strict verification process. Tutors must submit official CNIC documents for NADRA security checks, profile pictures, and verified academic credentials to ensure safety for children and parents."
    },
    {
      q: "How do parents hire a tutor?",
      a: "Parents can post a tuition requirement job for free on the Parent Dashboard. Verified tutors nearby review the job and submit applications directly. Parents can then review applicant profiles, view credentials, and contact them directly."
    },
    {
      q: "Is there any fee for parents to post jobs?",
      a: "No! Posting tuition jobs and reviewing verified tutor applications is completely free for parents."
    },
    {
      q: "How do I update my credentials as a tutor?",
      a: "Log into your tutor portal, head over to 'Settings & Verifications', and you can securely upload your degrees, experience letters, profile pictures, and CNIC details."
    }
  ];

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 sm:px-6 lg:px-8 font-sans text-[#334155]">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Breadcrumb */}
        <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200">
          <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">FAQs</span>
        </nav>

        {/* Header Hero */}
        <div className="bg-white p-8 sm:p-12 rounded-3xl border border-gray-200 shadow-sm space-y-4 text-center">
          <span className="px-3 py-1 bg-emerald-50 text-[#059669] text-xs font-black uppercase tracking-widest rounded-full border border-emerald-200 inline-block">
            Got Questions?
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-[#0F172A]">
            Frequently Asked Questions
          </h1>
          <p className="text-sm text-gray-600 max-w-xl mx-auto leading-relaxed">
            Everything you need to know about Pakistan's largest verified zero-commission tutoring network.
          </p>
        </div>

        {/* FAQ List */}
        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-2">
              <h3 className="text-sm sm:text-base font-black text-[#0F172A] flex items-start gap-2">
                <span className="text-[#059669]">Q{idx + 1}.</span> {faq.q}
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 leading-relaxed pl-5">
                {faq.a}
              </p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}