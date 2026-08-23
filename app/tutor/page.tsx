"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const publicTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    subject: "Mathematics",
    grade: "10th Class",
    degree: "BS Mathematics (LUMS)",
    area: "Gulberg, Lahore",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    verified: true
  },
  {
    id: 2,
    name: "Muhammad Ali",
    subject: "Physics",
    grade: "FSc Part 2",
    degree: "BS Computer Science (PU)",
    area: "DHA, Lahore",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    verified: true
  },
  {
    id: 3,
    name: "Alee Sabeer",
    subject: "Computer Science",
    grade: "O-Levels",
    degree: "BS Software Engineering",
    area: "Clifton, Karachi",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150",
    verified: true
  }
];

export default function PublicTutorsPage() {
  const router = useRouter();
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const handleTransactionalAction = () => {
    setShowLoginPrompt(true);
  };

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8 flex-1 w-full text-[#334155]">
      
      {showLoginPrompt && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-bold shadow-sm flex items-center justify-between">
          <span>🔒 Please login or register as a verified parent to chat or hire tutors.</span>
          <div className="flex gap-2">
            <Link href="/parent/login" className="px-3 py-1.5 bg-[#0F172A] text-white rounded-xl">Login</Link>
            <button onClick={() => setShowLoginPrompt(false)} className="px-2 text-gray-500">✕</button>
          </div>
        </div>
      )}

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-2 text-center">
        <span className="px-3 py-1 bg-emerald-50 text-[#059669] border border-emerald-200 text-[11px] font-bold uppercase tracking-widest rounded-full">
          Verified & Audited Educators
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">Browse Verified Tutors</h1>
        <p className="text-xs text-gray-500 max-w-md mx-auto">
          Explore camera-verified home & online tutors across Pakistan. Zero commission forever.
        </p>
      </div>

      <div className="space-y-4">
        {publicTutors.map((tutor) => (
          <div key={tutor.id} className="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <img src={tutor.image} alt={tutor.name} className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-[#0F172A]">{tutor.name}</h4>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-bold uppercase rounded-full">
                    ✓ Camera Verified
                  </span>
                </div>
                <p className="text-xs font-bold text-[#059669]">Expert in {tutor.subject} ({tutor.grade})</p>
                <p className="text-[11px] text-gray-600 font-medium">🎓 {tutor.degree} • 📍 {tutor.area}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                onClick={handleTransactionalAction}
                className="px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-md"
              >
                💬 Chat
              </button>
              <button
                onClick={handleTransactionalAction}
                className="px-5 py-2.5 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl transition-all shadow-md"
              >
                HIRE ➔
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}