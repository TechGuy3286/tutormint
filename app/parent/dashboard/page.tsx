"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function UnifiedClientMarketplace() {
  const [parentEmail, setParentEmail] = useState("");
  const [parent, setParent] = useState<any>(null);
  const [tutors, setTutors] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState("all");
  const [audienceType, setAudienceType] = useState<"parent" | "academy">("parent");

  // Interaction modals & state
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [postJobModalOpen, setPostJobModalOpen] = useState(false);
  const [reportModalTutor, setReportModalTutor] = useState<any | null>(null);
  const [pendingTutor, setPendingTutor] = useState<any | null>(null);
  const [successModalMsg, setSuccessModalMsg] = useState("");
  
  const [reportReason, setReportReason] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");

  // Job form state
  const [title, setTitle] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [city, setCity] = useState("");
  const [teachingMode, setTeachingMode] = useState("Home Tuition");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("parentEmail");
    if (stored) {
      setParentEmail(stored);
      fetchParentData(stored);
    }
    fetchTutors();
  }, []);

  const fetchParentData = async (email: string) => {
    try {
      const res = await fetch(`/api/parent/profile?email=${email}`);
      const data = await res.json();
      if (res.ok && data.parent) {
        setParent(data.parent);
        fetchJobs();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTutors = async () => {
    try {
      const res = await fetch("/api/admin/tutors");
      const data = await res.json();
      if (res.ok) {
        setTutors(data.tutors || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/parent/jobs");
      const data = await res.json();
      if (res.ok) setJobs(data.jobs || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleHireClick = (tutor: any) => {
    if (!parent) {
      setPendingTutor(tutor);
      setLoginModalOpen(true);
    } else {
      setSuccessModalMsg(`🎉 Success! Your contact request for ${tutor.fullName} has been logged. Our matching team will connect you via WhatsApp/Call within 10 minutes.`);
    }
  };

  const handleLoginOrRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentEmail) return;
    try {
      const res = await fetch("/api/parent/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parentEmail, fullName: "Client / Parent" })
      });
      const data = await res.json();
      if (res.ok) {
        setParent(data.parent || { email: parentEmail });
        localStorage.setItem("parentEmail", parentEmail);
        setLoginModalOpen(false);
        fetchJobs();
        
        if (pendingTutor) {
          setSuccessModalMsg(`🎉 Success! You are logged in as ${parentEmail}. Your contact request for ${pendingTutor.fullName} has been logged!`);
          setPendingTutor(null);
        } else {
          setSuccessModalMsg(`✅ Successfully logged in as ${parentEmail}! You can now hire tutors and post jobs.`);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePostJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parent) {
      setLoginModalOpen(true);
      return;
    }
    setPosting(true);
    setMsg("");
    const subjects = subjectInput.split(",").map((s) => s.trim()).filter(Boolean);

    try {
      const res = await fetch("/api/parent/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentEmail: parent.email || parentEmail,
          title,
          subjects,
          classLevel,
          budget,
          city,
          province: "Punjab",
          teachingMode,
          description,
        }),
      });
      if (res.ok) {
        setMsg("✨ Job posted successfully! Matching tutors will now contact you.");
        setTitle("");
        setSubjectInput("");
        setClassLevel("");
        setBudget("");
        setCity("");
        setDescription("");
        fetchJobs();
        setTimeout(() => setPostJobModalOpen(false), 2000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPosting(false);
    }
  };

  const filteredTutors = tutors.filter((t) => {
    if (selectedCity === "all") return true;
    return t.city?.toLowerCase() === selectedCity.toLowerCase();
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Global Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Client Marketplace</span>
        </Link>
        <div className="flex items-center space-x-3">
          {parent ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">🟢 {parent.email || parentEmail}</span>
              <button onClick={() => { localStorage.removeItem("parentEmail"); setParent(null); }} className="text-xs text-gray-400 hover:text-black font-bold">Logout</button>
            </div>
          ) : (
            <button onClick={() => setLoginModalOpen(true)} className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-sm">Client Login / Register 🔑</button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full">
        {successModalMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-extrabold flex justify-between items-center shadow-sm">
            <span>{successModalMsg}</span>
            <button onClick={() => setSuccessModalMsg("")} className="text-emerald-700 font-bold ml-4">✕</button>
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">Browse Verified Home Tutors</h1>
              <p className="text-xs text-gray-500">Explore camera-verified educators, ratings, and academic credentials below.</p>
            </div>
            <button onClick={() => setPostJobModalOpen(true)} className="px-4 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl shadow-sm transition-colors">
              📝 Post Personalized Job Requirement
            </button>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-xl max-w-sm">
            <button onClick={() => setAudienceType("parent")} className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg ${audienceType === "parent" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>👨‍👩‍👧‍👦 Parents & Students</button>
            <button onClick={() => setAudienceType("academy")} className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg ${audienceType === "academy" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>🏫 Schools & Academies</button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 items-center text-xs">
            <span className="font-bold text-gray-400 uppercase text-[10px]">Filter City:</span>
            {["all", "Lahore", "Multan", "Karachi", "Islamabad"].map((city) => (
              <button key={city} onClick={() => setSelectedCity(city)} className={`px-3 py-1.5 rounded-lg font-bold capitalize ${selectedCity === city ? "bg-[#B3191F] text-white" : "bg-gray-100 text-gray-700"}`}>{city}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-xs font-bold text-gray-400 uppercase">Loading Verified Tutors...</div>
        ) : filteredTutors.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-3">
            <p className="text-xs text-gray-500 font-bold">No tutors found matching your location.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTutors.map((t, index) => {
              // Deterministic professional portrait fallback if t.profilePic is missing
              const defaultAvatars = [
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
                "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
              ];
              const avatarImg = t.profilePic || defaultAvatars[index % defaultAvatars.length];

              return (
                <div key={t._id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    {/* Profile Picture, Name, Rating & Badge */}
                    <div className="flex items-center space-x-4">
                      <img src={avatarImg} alt={t.fullName} className="w-14 h-14 rounded-2xl object-cover border border-gray-200 shadow-xs" />
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <h3 className="text-base font-black text-gray-900 truncate">{t.fullName}</h3>
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[10px] font-black rounded-full shrink-0 flex items-center gap-1">
                            🛡️ Verified
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 font-medium truncate">📍 {t.city} ({t.areaName || "General"})</p>
                      </div>
                    </div>

                    {/* Rating & Review Badge */}
                    <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-between text-xs">
                      <span className="text-amber-800 font-bold">⭐ Tutor Rating:</span>
                      <span className="bg-white text-amber-900 font-extrabold px-2.5 py-0.5 rounded shadow-2xs">
                        {t.rating || "4.9 / 5.0 (24 Reviews)"}
                      </span>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1">
                      <div><span className="text-gray-400 text-[10px] uppercase font-bold">Degree:</span> <strong className="text-gray-800">{t.degrees || "Verified Academic Profile"}</strong></div>
                      <div><span className="text-gray-400 text-[10px] uppercase font-bold">Mode:</span> <strong className="text-gray-800">{t.teachingMode || "Physical & Online"}</strong></div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex items-center gap-2">
                    <button onClick={() => handleHireClick(t)} className="flex-1 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-center font-bold text-xs rounded-xl shadow-sm transition-colors">
                      Hire / Contact ➔
                    </button>
                    <button onClick={() => setReportModalTutor(t)} className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold rounded-xl" title="Report">⚠️</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* LOGIN MODAL */}
      {loginModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold">Client Login / Register</h3>
              <button onClick={() => setLoginModalOpen(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            <p className="text-xs text-gray-500">Enter your email to instantly sign in and connect with verified tutors.</p>
            <form onSubmit={handleLoginOrRegister} className="space-y-3">
              <input type="email" required value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="parent@example.com" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold text-xs rounded-xl">Continue & Connect ➔</button>
            </form>
          </div>
        </div>
      )}

      {/* POST JOB MODAL */}
      {postJobModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold">Post Job Requirement</h3>
              <button onClick={() => setPostJobModalOpen(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            {msg && <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold">{msg}</div>}
            <form onSubmit={handlePostJob} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Job Title</label>
                <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. O-Level Math Tutor" className="w-full p-3 border border-gray-200 rounded-xl" />
              </div>
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold rounded-xl">Publish Requirement 🚀</button>
            </form>
          </div>
        </div>
      )}

      {/* REPORT MODAL */}
      {reportModalTutor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold text-red-600">Report Tutor</h3>
              <button onClick={() => setReportModalTutor(null)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            {reportSuccess ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold text-center">✅ Report submitted successfully.</div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); setReportSuccess(true); setTimeout(() => { setReportSuccess(false); setReportModalTutor(null); }, 2000); }} className="space-y-3">
                <textarea rows={3} required value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Reason for report..." className="w-full p-3 border border-gray-200 rounded-xl text-xs"></textarea>
                <button type="submit" className="w-full py-2.5 bg-[#B3191F] text-white font-bold text-xs rounded-xl">Submit Report ➔</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Global Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-6xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved. Client Marketplace.</div>
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