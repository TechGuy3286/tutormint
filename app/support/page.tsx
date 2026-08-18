"use client";
import Link from "next/link";
import { useState } from "react";

export default function SupportPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Global Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Support Center</span>
        </Link>
        <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
          🏠 Home
        </Link>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-6 py-12 flex-1 w-full space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight text-gray-900">Customer & Tutor Support</h1>
            <p className="text-xs text-gray-500 font-medium">Need assistance with your account, job postings, or profile verification? Our team is here to help.</p>
          </div>

          {submitted ? (
            <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold text-center">
              ✅ Your support ticket has been received! Our team will contact you within 24 hours.
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Your Email</label>
                <input type="email" required placeholder="name@example.com" className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Issue / Inquiry Type</label>
                <select className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black">
                  <option>Profile Verification Assistance</option>
                  <option>Parent Job Posting Support</option>
                  <option>Application Credits & Billing</option>
                  <option>Other Technical Inquiry</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Message Details</label>
                <textarea rows={4} required placeholder="Describe your issue..." className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"></textarea>
              </div>
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold rounded-xl text-xs uppercase shadow-sm">
                Submit Support Ticket ➔
              </button>
            </form>
          )}
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