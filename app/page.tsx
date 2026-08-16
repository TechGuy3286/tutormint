"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Sleek Modern Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider">Verified Home Tutors</span>
        </Link>
        <div className="flex items-center space-x-3">
          <Link href="/tutor/login" className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl transition-colors">
            🔑 Tutor Login
          </Link>
          <Link href="/parent/dashboard" className="px-4 py-2 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl transition-colors shadow-sm">
            👨‍👩‍👧‍👦 Parent Portal
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 py-16 text-center space-y-8">
        <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-1.5 rounded-full text-xs font-extrabold">
          ✨ Verified Home Tutors & Smart Job Matching
        </div>

        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-tight">
          Connect with <span className="text-[#B3191F]">Elite Tutors</span> Verified on Camera.
        </h1>

        <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto font-medium">
          TutorMint eliminates fake credentials. Every tutor records a live 60-second video introduction showcasing their degree on camera, verified directly by administrators.
        </p>

        {/* Action Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 text-left">
          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 hover:border-gray-300 transition-colors">
            <span className="text-3xl bg-blue-50 p-3 rounded-2xl inline-block">👨‍🏫</span>
            <h3 className="text-base font-extrabold">For Tutors</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Register your profile, record your live video introduction, and apply for high-paying student tuition jobs using application credits.</p>
            <div className="pt-2">
              <Link href="/tutor/register" className="inline-block px-4 py-2.5 bg-gray-900 hover:bg-black text-white font-bold text-xs rounded-xl transition-colors">
                Register as Tutor →
              </Link>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 hover:border-gray-300 transition-colors">
            <span className="text-3xl bg-emerald-50 p-3 rounded-2xl inline-block">👨‍👩‍👧‍👦</span>
            <h3 className="text-base font-extrabold">For Parents</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Post your specific tuition requirements, review verified tutor applications, and connect with trusted educators in your city.</p>
            <div className="pt-2">
              <Link href="/parent/dashboard" className="inline-block px-4 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors">
                Parent Portal →
              </Link>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 hover:border-gray-300 transition-colors">
            <span className="text-3xl bg-amber-50 p-3 rounded-2xl inline-block">🛡️</span>
            <h3 className="text-base font-extrabold">Admin Center</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Securely review degree showcase videos, verify tutor profiles, manage credit balances, and monitor platform activity.</p>
            <div className="pt-2">
              <Link href="/admin/dashboard" className="inline-block px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition-colors">
                Admin Login →
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400">
        © 2026 TutorMint. All rights reserved. High-End Verified Home Tutoring Ecosystem.
      </footer>
    </div>
  );
}