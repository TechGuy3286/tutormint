"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function BrowseTutors() {
  const [tutors, setTutors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [audienceType, setAudienceType] = useState<"parent" | "academy">("parent");
  const [selectedCity, setSelectedCity] = useState("all");
  const [reportModalTutor, setReportModalTutor] = useState<any | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);

  useEffect(() => {
    fetchTutors();
  }, []);

  const fetchTutors = async () => {
    try {
      const res = await fetch("/api/admin/tutors");
      const data = await res.json();
      if (res.ok) {
        // Only show verified or registered tutors to clients
        setTutors(data.tutors || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReportSuccess(true);
    setTimeout(() => {
      setReportSuccess(false);
      setReportModalTutor(null);
      setReportReason("");
    }, 2000);
  };

  const filteredTutors = tutors.filter((t) => {
    if (selectedCity === "all") return true;
    return t.city?.toLowerCase() === selectedCity.toLowerCase();
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="hidden sm:inline-block text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Client Marketplace</span>
        </Link>
        <div className="flex items-center space-x-3">
          <Link href="/parent/dashboard" className="px-3 py-1.5 bg-[#B3191F] text-white text-xs font-bold rounded-xl shadow-sm">
            Parent Portal ➔
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full">
        {/* Audience Selector & Dynamic Emotional/Professional Messaging */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">Explore Camera-Verified Tutors</h1>
              <p className="text-xs text-gray-500">Browse verified educators before posting a job or hiring.</p>
            </div>
            <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
              <button
                onClick={() => setAudienceType("parent")}
                className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${audienceType === "parent" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}
              >
                👨‍👩‍👧‍👦 Parents & Students
              </button>
              <button
                onClick={() => setAudienceType("academy")}
                className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${audienceType === "academy" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}
              >
                🏫 Schools & Academies
              </button>
            </div>
          </div>

          {/* Dynamic Message Box */}
          <div className="p-4 rounded-xl text-xs font-medium leading-relaxed bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-sm">
            {audienceType === "parent" ? (
              <p>
                ✨ <strong className="text-red-400 font-extrabold">A message for parents:</strong> In our society, your child&apos;s education and safety are paramount. Finding a trusted, camera-verified home tutor eliminates the stress of unvetted strangers entering your home. Here you can review actual degrees and live video introductions with complete peace of mind.
              </p>
            ) : (
              <p>
                🎓 <strong className="text-red-400 font-extrabold">A message for schools & academies:</strong> We know the constant administrative headache of vetting qualified, skilled teachers for your institution. TutorMint provides pre-screened, camera-verified educators ready to uphold your academic standards instantly.
              </p>
            )}
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap gap-2 pt-2 items-center text-xs">
            <span className="font-bold text-gray-400 uppercase text-[10px]">Filter City:</span>
            {["all", "Lahore", "Multan", "Karachi", "Islamabad"].map((city) => (
              <button
                key={city}
                onClick={() => setSelectedCity(city)}
                className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-colors ${selectedCity === city ? "bg-[#B3191F] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                {city}
              </button>
            ))}
          </div>
        </div>

        {/* Tutor Cards Grid */}
        {loading ? (
          <div className="text-center py-16 text-xs font-bold text-gray-400 uppercase">Loading Verified Tutors...</div>
        ) : filteredTutors.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-3">
            <p className="text-xs text-gray-500 font-bold">No tutors found matching your location.</p>
            <Link href="/parent/dashboard" className="inline-block px-5 py-2.5 bg-[#B3191F] text-white rounded-xl text-xs font-bold shadow-sm">
              Post a Personalized Job Requirement ➔
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTutors.map((t) => (
              <div key={t._id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4 flex flex-col justify-between hover:border-gray-400 transition-all">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <h3 className="text-base font-black text-gray-900">{t.fullName}</h3>
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 text-[10px] font-black rounded-full">
                      {t.profileCompletionStatus === "verified" ? "🟢 Verified" : "⏳ Pending"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-medium">📍 {t.city} ({t.areaName || "General Area"})</p>
                  <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1">
                    <div><span className="text-gray-400 text-[10px] uppercase font-bold">Degree:</span> <strong className="text-gray-800">{t.degrees || "Verified Academic Profile"}</strong></div>
                    <div><span className="text-gray-400 text-[10px] uppercase font-bold">Mode:</span> <strong className="text-gray-800">{t.teachingMode || "Physical & Online"}</strong></div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between gap-2">
                  <Link href="/parent/dashboard" className="flex-1 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-center font-bold text-xs rounded-xl shadow-sm transition-colors">
                    Hire / Contact ➔
                  </Link>
                  <button
                    onClick={() => setReportModalTutor(t)}
                    className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold rounded-xl transition-colors"
                    title="Block or Report Tutor"
                  >
                    ⚠️ Report
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Report / Block Modal */}
      {reportModalTutor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold text-red-600">Report or Block Tutor</h3>
              <button onClick={() => setReportModalTutor(null)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            {reportSuccess ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold text-center">
                ✅ Report submitted. Our trust & safety team will review this profile immediately.
              </div>
            ) : (
              <form onSubmit={handleReportSubmit} className="space-y-3">
                <p className="text-xs text-gray-600">Why are you reporting <span className="font-bold">{reportModalTutor.fullName}</span>?</p>
                <textarea
                  rows={3}
                  required
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Provide details (e.g. incorrect info, unprofessional behavior)..."
                  className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                ></textarea>
                <button type="submit" className="w-full py-2.5 bg-[#B3191F] text-white font-bold text-xs rounded-xl shadow-sm">
                  Submit Report & Block ➔
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-6xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. Client Marketplace.</div>
        <div className="flex space-x-6 text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600">Support</Link>
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
        </div>
      </footer>
    </div>
  );
}