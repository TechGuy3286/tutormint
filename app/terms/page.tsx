import Link from "next/link";

export default function TermsConditionsPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 sm:px-6 lg:px-8 font-sans text-[#334155]">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Breadcrumb */}
        <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200">
          <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Terms & Conditions</span>
        </nav>

        {/* Header Hero */}
        <div className="bg-white p-8 sm:p-12 rounded-3xl border border-gray-200 shadow-sm space-y-4 text-center">
          <span className="px-3 py-1 bg-emerald-50 text-[#059669] text-xs font-black uppercase tracking-widest rounded-full border border-emerald-200 inline-block">
            Platform Guidelines
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-[#0F172A]">
            Terms & Conditions
          </h1>
          <p className="text-sm text-gray-600 max-w-xl mx-auto leading-relaxed">
            Effective Date: August 2026. Please read these terms carefully before using the TutorMint platform.
          </p>
        </div>

        {/* Content Sections */}
        <div className="bg-white p-8 sm:p-10 rounded-3xl border border-gray-200 shadow-sm space-y-6 text-xs sm:text-sm leading-relaxed text-gray-700">
          
          <div className="space-y-2">
            <h2 className="text-base font-black text-[#0F172A]">1. Acceptance of Terms</h2>
            <p>
              By accessing or using TutorMint (tutormint.org), you agree to be bound by these Terms & Conditions. If you do not agree with any part of these terms, you must refrain from using our platform, portals, and services.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-black text-[#059669]">2. Zero-Commission Policy</h2>
            <p>
              TutorMint operates strictly on a zero-commission model for educators. Tutors keep 100% of their earnings agreed upon with parents. Any attempt by third parties or users to levy external agency fees through our infrastructure violates platform policy.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-black text-[#0F172A]">3. Tutor Verification & Accountability</h2>
            <p>
              Tutors registering on the network commit to providing accurate credentials, genuine CNIC verifications, and authentic academic records. Misrepresentation of identity or fraudulent documents will result in immediate permanent account termination.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-black text-[#0F172A]">4. Parent Responsibilities</h2>
            <p>
              Parents and guardians posting tuition jobs agree to provide honest requirement details and maintain professional conduct when interacting with applicants. While we enforce strict verification standards, parents retain final discretion when selecting and hiring educators.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-black text-[#0F172A]">5. Modifications to Terms</h2>
            <p>
              We reserve the right to modify or update these terms at any time to reflect platform enhancements and regulatory standards. Continued use of TutorMint constitutes acceptance of any revised guidelines.
            </p>
          </div>

        </div>

      </div>
    </main>
  );
}