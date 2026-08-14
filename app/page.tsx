"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const rotatingPhrases = [
  "Grow Your Teaching Career",
  "Achieve Academic Excellence",
  "Connect with Verified Tutors",
  "Unlock Your Full Potential",
];

export default function Home() {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setCurrentPhraseIndex((prev) => (prev + 1) % rotatingPhrases.length);
        setFade(true);
      }, 300);
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F9FAFB] to-white flex flex-col justify-between font-sans text-[#161616] selection:bg-[#B3191F] selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-4 flex justify-between items-center max-w-7xl mx-auto w-full transition-all">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-1">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="w-2 h-2 rounded-full bg-[#B3191F] mb-3"></span>
        </Link>
        <div className="flex items-center gap-3">
          <Link 
            href="/tutor/login" 
            className="text-sm font-semibold px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Tutor Login
          </Link>
          <Link 
            href="/parent/login" 
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-[#B3191F] transition-colors"
          >
            Parent Login
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 py-20 text-center flex-grow flex flex-col justify-center">
        {/* Pill Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-50 border border-red-100 text-[#B3191F] text-xs font-bold uppercase tracking-wider mx-auto mb-6 shadow-sm animate-pulse">
          <span>🚀 Pakistan's Trusted Education Network</span>
        </div>

        <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 leading-tight">
          Find Verified Tutors or <br />
          <span className={`text-[#B3191F] transition-opacity duration-300 inline-block ${fade ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
            {rotatingPhrases[currentPhraseIndex]}
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-12 leading-relaxed">
          TutorMint connects qualified home and online educators with parents and students seeking top-tier academic excellence across a nationwide footprint.
        </p>

        {/* Action Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto w-full text-left">
          
          {/* Tutor Card */}
          <div className="group bg-white p-8 rounded-2xl shadow-sm border border-gray-200/80 flex flex-col justify-between hover:border-[#B3191F] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div>
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-[#B3191F] font-bold mb-4 group-hover:scale-110 transition-transform">
                👨‍🏫
              </div>
              <span className="text-xs font-bold text-[#B3191F] uppercase tracking-wider block mb-1">For Educators</span>
              <h3 className="text-2xl font-extrabold mb-3 text-gray-900">Join as a Tutor</h3>
              <p className="text-gray-500 text-sm mb-8 leading-relaxed">
                Register your profile, list your academic credentials, choose your preferred teaching modes, and connect with eager students.
              </p>
            </div>
            <div className="flex gap-3">
              <Link 
                href="/tutor/register" 
                className="flex-1 py-3 bg-[#B3191F] text-white rounded-xl font-bold text-center hover:bg-red-800 shadow-md shadow-red-900/10 transition-all"
              >
                Register
              </Link>
              <Link 
                href="/tutor/login" 
                className="px-5 py-3 border border-gray-200 rounded-xl font-bold text-center text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Login
              </Link>
            </div>
          </div>

          {/* Parent / Student Card */}
          <div className="group bg-white p-8 rounded-2xl shadow-sm border border-gray-200/80 flex flex-col justify-between hover:border-[#B3191F] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div>
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-[#B3191F] font-bold mb-4 group-hover:scale-110 transition-transform">
                📚
              </div>
              <span className="text-xs font-bold text-[#B3191F] uppercase tracking-wider block mb-1">For Parents & Students</span>
              <h3 className="text-2xl font-extrabold mb-3 text-gray-900">Hire a Tutor</h3>
              <p className="text-gray-500 text-sm mb-8 leading-relaxed">
                Create your student profile and browse a verified catalog of experienced home and online educators ready to assist.
              </p>
            </div>
            <div className="flex gap-3">
              <Link 
                href="/parent/register" 
                className="flex-1 py-3 bg-[#B3191F] text-white rounded-xl font-bold text-center hover:bg-red-800 shadow-md shadow-red-900/10 transition-all"
              >
                Register
              </Link>
              <Link 
                href="/parent/login" 
                className="px-5 py-3 border border-gray-200 rounded-xl font-bold text-center text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Login
              </Link>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-8 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} TutorMint. All rights reserved.</p>
      </footer>
    </div>
  );
}