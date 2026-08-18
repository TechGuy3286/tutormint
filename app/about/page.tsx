"use client";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Global Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">About Us</span>
        </Link>
        <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
          🏠 Home
        </Link>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 w-full space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm space-y-6">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">About TutorMint</h1>
          <p className="text-xs text-gray-500 font-semibold">The premier ecosystem connecting parents and schools with camera-verified home tutors.</p>
          
          <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
            <p>TutorMint was founded with a singular mission: to eliminate fake credentials and provide families across Pakistan with absolute peace of mind when hiring home educators.</p>
            
            <h3 className="text-sm font-extrabold text-gray-900 pt-2">Our Core Standard: Camera Verification</h3>
            <p>Unlike traditional classified platforms where anyone can post fake degrees, every educator on TutorMint records a live 60-second video introduction showcasing their actual academic certificates on camera, reviewed and verified by our administrative team.</p>

            <h3 className="text-sm font-extrabold text-gray-900 pt-2">Empowering Tutors & Clients</h3>
            <p>We provide tutors with starting bonus application credits and high-value tuition opportunities while giving parents and academies an intuitive dashboard to post requirements and hire trusted professionals.</p>
          </div>
        </div>
      </main>

      {/* Global Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-6xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved.</div>
        <div className="flex space-x-6 text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600">Support</Link>
          <Link href="/about" className="hover:text-gray-600">About</Link>
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
        </div>
      </footer>
    </div>
  );
}