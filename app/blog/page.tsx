"use client";
import Link from "next/link";

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Global Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Platform Blog</span>
        </Link>
        <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
          🏠 Home
        </Link>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 w-full space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">TutorMint Blog & Insights</h1>
          <p className="text-xs text-gray-500 font-medium">Read articles on home tutoring best practices, exam preparation tips, and verified educator spotlights.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3 shadow-sm">
            <span className="text-[10px] font-black uppercase bg-red-50 text-[#B3191F] px-2.5 py-1 rounded-md">Education</span>
            <h3 className="text-base font-extrabold">Why Camera Verification Matters for Home Tutors</h3>
            <p className="text-xs text-gray-500">Discover how live video verification protects families and elevates professional educators in Pakistan.</p>
            <span className="text-[11px] font-bold text-gray-900 block pt-2">August 15, 2026</span>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3 shadow-sm">
            <span className="text-[10px] font-black uppercase bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md">Parenting</span>
            <h3 className="text-base font-extrabold">Top 5 Tips for Preparing Your Child for O/A-Level Exams</h3>
            <p className="text-xs text-gray-500">Expert advice from our top-rated verified math and physics home tutors.</p>
            <span className="text-[11px] font-bold text-gray-900 block pt-2">August 10, 2026</span>
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