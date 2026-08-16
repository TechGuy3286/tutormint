"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const QUOTES = [
  "✨ TutorMint is the ultimate trusted platform for verified home tutors.",
  "🌟 The best place to find verified, high-quality tutors in your local area.",
  "🎓 Every tutor is verified on camera with actual degree proof and live video verification."
];

export default function Home() {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between relative">
      {/* Rotating Announcement Bar */}
      <div className="bg-gradient-to-r from-gray-900 via-[#B3191F] to-gray-900 text-white text-center py-2 px-4 text-xs font-bold tracking-wide transition-all duration-500 shadow-sm">
        {QUOTES[quoteIndex]}
      </div>

      {/* Sleek Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Verified Portal</span>
        </Link>
        <div className="flex items-center space-x-6">
          {/* Header Panels Dropdown / Navigation */}
          <div className="hidden md:flex items-center space-x-4 text-xs font-bold text-gray-700">
            <div className="group relative cursor-pointer py-2">
              <span className="hover:text-[#B3191F] transition-colors">Client Panel ▾</span>
              <div className="absolute top-full left-0 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-2 hidden group-hover:block space-y-1">
                <Link href="/parent/dashboard" className="block px-4 py-2 hover:bg-gray-50 text-gray-800">Parents & Students</Link>
                <Link href="/parent/dashboard" className="block px-4 py-2 hover:bg-gray-50 text-gray-800">Academies & Schools</Link>
              </div>
            </div>
            <div className="group relative cursor-pointer py-2">
              <span className="hover:text-[#B3191F] transition-colors">Tutors Panel ▾</span>
              <div className="absolute top-full left-0 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-2 hidden group-hover:block space-y-1">
                <Link href="/tutor/login" className="block px-4 py-2 hover:bg-gray-50 text-gray-800">Tutor Login</Link>
                <Link href="/tutor/register" className="block px-4 py-2 hover:bg-gray-50 text-gray-800">Register Profile</Link>
              </div>
            </div>
          </div>
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
        <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-1.5 rounded-full text-xs font-extrabold animate-pulse">
          ✨ The Ultimate Network for Verified Home Tutors
        </div>

        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-tight">
          Connect with <span className="text-[#B3191F] underline decoration-wavy decoration-red-200">Elite Tutors</span> Verified on Camera.
        </h1>

        <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto font-medium">
          Eliminate fake credentials. Every educator records a live 60-second video introduction showcasing their actual degrees on camera, reviewed and verified by our administrative team.
        </p>

        {/* Action Cards (Tutors & Parents only - Admin is private login) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 max-w-3xl mx-auto text-left">
          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 hover:border-gray-400 transition-all">
            <span className="text-3xl bg-blue-50 p-3 rounded-2xl inline-block">👨‍🏫</span>
            <h3 className="text-lg font-extrabold">For Tutors & Educators</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Claim your bonus application credits, record your live degree video introduction, and apply for high-value student tuition opportunities.</p>
            <div className="pt-2">
              <Link href="/tutor/register" className="inline-block px-5 py-3 bg-gray-900 hover:bg-black text-white font-bold text-xs rounded-xl transition-colors">
                Register as Tutor →
              </Link>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4 hover:border-gray-400 transition-all">
            <span className="text-3xl bg-emerald-50 p-3 rounded-2xl inline-block">👨‍👩‍👧‍👦</span>
            <h3 className="text-lg font-extrabold">For Parents, Schools & Academies</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Post your specific tuition requirements, review camera-verified tutor credentials, and hire trusted educators in your neighborhood.</p>
            <div className="pt-2">
              <Link href="/parent/dashboard" className="inline-block px-5 py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors shadow-sm">
                Parent / Client Portal →
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Sticky Bottom-Right Support Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen && (
          <div className="mb-3 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 space-y-3 animate-in slide-in-from-bottom-5">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <span className="text-xs font-black uppercase text-gray-800">💬 TutorMint Support Bot</span>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-black font-bold text-sm">✕</button>
            </div>
            <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-xl">Hello! Welcome to TutorMint. How can we assist you with verified home tutors today?</p>
            <input type="text" placeholder="Type your message..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
          </div>
        )}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-14 h-14 bg-[#B3191F] hover:bg-[#9a151b] text-white rounded-full shadow-2xl flex items-center justify-center text-xl transition-transform hover:scale-105"
        >
          💬
        </button>
      </div>

      {/* Footer with Dimmed Links */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col md:flex-row justify-between items-center max-w-6xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved. High-End Verified Home Tutoring Ecosystem.</div>
        <div className="flex space-x-6 text-gray-400 font-medium text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600 transition-colors">Support</Link>
          <Link href="/about" className="hover:text-gray-600 transition-colors">About</Link>
          <Link href="/team" className="hover:text-gray-600 transition-colors">Team</Link>
        </div>
      </footer>
    </div>
  );
}