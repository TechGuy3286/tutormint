"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const heroVariations = [
  {
    tag: "🛡️ ZERO FAKE CREDENTIALS • 100% CAMERA VERIFIED",
    titlePrefix: "Find Trusted, Camera-Verified Home Tutors in ",
    highlight: "Pakistan",
    description: "Eliminate uncertainty. Every educator on TutorMint records a live 60-second video introduction showcasing their actual degrees on camera, rigorously reviewed and approved by our administrative team."
  },
  {
    tag: "🎓 SAY GOODBYE TO FAKE CVS • ELITE EDUCATORS",
    titlePrefix: "Hire Verified, Camera-Audited Tutors ",
    highlight: "Instantly & Securely",
    description: "Your child's safety and education deserve real credentials, not unvetted strangers. Browse background-checked teachers with verified academic proofs."
  },
  {
    tag: "🏫 DESIGNED FOR PARENTS & TOP SCHOOLS",
    titlePrefix: "The Smarter Way to Secure ",
    highlight: "Qualified Teaching Talent",
    description: "Whether you're a parent protecting your child's future or an academy seeking reliable staff, TutorMint delivers pre-screened educators ready to excel."
  },
  {
    tag: "✨ REAL DEGREES • REAL VIDEO PROOF • ZERO RISK",
    titlePrefix: "Discover Top-Rated Home Tutors Across ",
    highlight: "All Major Cities",
    description: "From Lahore to Islamabad, Karachi to Multan—connect with elite, camera-verified educators who meet the highest standards of academic excellence."
  }
];

export default function HomePage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"verification" | "safety" | "matching">("verification");

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % heroVariations.length);
    }, 4500); // Loops automatically every 4.5 seconds
    return () => clearInterval(interval);
  }, []);

  const hero = heroVariations[currentIndex];

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Top Header / Navigation */}
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

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-6 py-12 sm:py-16 space-y-20 flex-1 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Auto-Looping Dynamic Value Prop with Fixed Height to Prevent Shifting */}
          <div className="lg:col-span-7 space-y-6 text-left">
            <div className="inline-flex items-center gap-2 bg-red-50 border border-red-100 text-[#B3191F] px-3 py-1.5 rounded-full text-xs font-extrabold tracking-wide uppercase">
              {hero.tag}
            </div>

            {/* Fixed Height Container locks the layout so text changes never cause button/card shifting */}
            <div className="min-h-[200px] sm:min-h-[180px] flex flex-col justify-start space-y-4">
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
                {hero.titlePrefix}<span className="text-[#B3191F]">{hero.highlight}</span>
              </h1>
              <p className="text-sm sm:text-base text-gray-600 font-medium leading-relaxed">
                {hero.description}
              </p>
            </div>

            {/* Dual Action CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Link href="/parent/dashboard" className="px-6 py-3.5 bg-gray-900 hover:bg-black text-white text-xs font-extrabold rounded-2xl shadow-sm text-center transition-all flex items-center justify-center gap-2">
                👨‍👩‍👧‍👦 Browse Verified Tutors Instantly ➔
              </Link>
              <Link href="/tutor/register" className="px-6 py-3.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-extrabold rounded-2xl shadow-sm text-center transition-all flex items-center justify-center gap-2">
                🚀 Register as a Tutor (Fast Sign Up)
              </Link>
            </div>
          </div>

          {/* Right Column: Interactive Verification Feature */}
          <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
            <h3 className="text-sm font-black uppercase text-gray-400 tracking-wider">How Trust is Verified</h3>
            
            {/* Interactive Tab Selectors */}
            <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-bold">
              <button onClick={() => setActiveTab("verification")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "verification" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>🎥 Video & Degrees</button>
              <button onClick={() => setActiveTab("safety")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "safety" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>🛡️ Parent Safety</button>
              <button onClick={() => setActiveTab("matching")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "matching" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>⚡ Quick Match</button>
            </div>

            {/* Dynamic Content Card */}
            <div className="p-4 bg-gray-50 rounded-2xl text-xs leading-relaxed space-y-2 border border-gray-100 min-h-[120px] flex flex-col justify-center">
              {activeTab === "verification" && (
                <>
                  <strong className="text-gray-900 text-sm block">60-Second On-Camera Verification</strong>
                  <p className="text-gray-600">Every tutor must hold their physical degree on camera and speak live during registration. Our admins manually audit every file before approval.</p>
                </>
              )}
              {activeTab === "safety" && (
                <>
                  <strong className="text-gray-900 text-sm block">Peace of Mind for Pakistani Families</strong>
                  <p className="text-gray-600">Never let unvetted strangers into your home. Know exactly who is teaching your child with complete location and ID tracking.</p>
                </>
              )}
              {activeTab === "matching" && (
                <>
                  <strong className="text-gray-900 text-sm block">Direct Connect & Job Posting</strong>
                  <p className="text-gray-600">Browse tutors instantly by city or post a personalized job requirement to have matching educators contact you within minutes.</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats / Trust Badges (Lowered down with generous separation) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-10 border-t border-gray-200">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1">
            <div className="text-xl font-black text-[#B3191F]">100%</div>
            <div className="text-xs font-bold text-gray-900">Camera-Verified Degrees</div>
            <p className="text-xs text-gray-500">No forged certificates or unvetted profiles.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1">
            <div className="text-xl font-black text-gray-900">Lahore & Beyond</div>
            <div className="text-xs font-bold text-gray-900">Active Across Major Cities</div>
            <p className="text-xs text-gray-500">Multan, Karachi, Islamabad, and Lahore.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1">
            <div className="text-xl font-black text-emerald-600">10 Min Response</div>
            <div className="text-xs font-bold text-gray-900">Fast WhatsApp Coordination</div>
            <p className="text-xs text-gray-500">Connect with educators instantly.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-6xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved. Verified Education Platform.</div>
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