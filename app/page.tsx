import Link from 'next/link';

// Technical SEO Foundation: Server-Side Metadata for localized search
export const metadata = {
  title: 'Find Physically Verified Home Tutors in Lahore | TutorMint',
  description: 'The only freemium platform in Lahore guaranteeing safety through mandatory in-person degree and CNIC verification. Book free demos in DHA, Johar Town, and Gulberg.',
  keywords: 'home tutor Lahore, verified tutors DHA, O level tutor Johar Town, private tuition Lahore',
};

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#161616] font-sans selection:bg-[#F1A80A] selection:text-[#161616]">
      
      {/* Navigation Header */}
      <header className="flex justify-between items-center p-6 lg:px-12 border-b-2 border-[#EDEDED]">
        <Link href="/" className="text-3xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
        </Link>
        <nav className="hidden md:flex gap-8 items-center font-semibold text-sm">
          <Link href="/tutors/lahore" className="text-gray-600 hover:text-[#B3191F] transition-colors">
            Lahore Tutors
          </Link>
          <Link href="/how-it-works" className="text-gray-600 hover:text-[#B3191F] transition-colors">
            How It Works
          </Link>
          <button className="bg-[#161616] text-[#FFFFFF] px-6 py-2.5 rounded hover:bg-gray-800 transition-colors">
            Sign In
          </button>
        </nav>
      </header>

      {/* Primary Hero Section - Optimized for Core Web Vitals (No heavy layout shifts) */}
      <main className="flex flex-col justify-center items-center text-center mt-8 mx-4 md:mx-12 bg-[#EDEDED] rounded-2xl px-6 py-24 lg:py-32 border-t-8 border-[#B3191F]">
        
        {/* Target Keyword H1 */}
        <h1 className="text-4xl md:text-6xl font-extrabold mb-6 text-[#161616] leading-tight max-w-4xl">
          Find Physically Verified <br className="hidden md:block" /> 
          <span className="text-[#B3191F]">Home Tutors in Lahore</span>
        </h1>
        
        <p className="text-lg md:text-xl text-gray-700 mb-10 max-w-2xl leading-relaxed">
          The only freemium platform guaranteeing safety through mandatory in-person degree and CNIC verification. 
        </p>
        
        {/* Primary Conversion Actions */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <button className="bg-[#B3191F] text-[#FFFFFF] px-8 py-4 rounded-lg font-bold text-lg hover:bg-red-800 shadow-lg transition-transform hover:scale-105">
            Find a Tutor Now
          </button>
          <button className="bg-[#FFFFFF] border-2 border-[#161616] text-[#161616] px-8 py-4 rounded-lg font-bold text-lg hover:bg-gray-50 transition-colors">
            Apply as a Tutor
          </button>
        </div>
      </main>
      
      {/* Secondary Trust Signals */}
      <section className="text-center mt-16 mb-16 px-4">
         <h2 className="font-bold text-sm text-gray-500 uppercase tracking-widest mb-6">
           Highly Requested Neighborhoods
         </h2>
         <div className="flex flex-wrap justify-center gap-6 md:gap-12 text-[#F1A80A] font-extrabold text-xl md:text-2xl opacity-90">
            <span>DHA Phase 1-8</span>
            <span>Johar Town</span>
            <span>Gulberg</span>
            <span>Bahria Town</span>
         </div>
      </section>

    </div>
  );
}