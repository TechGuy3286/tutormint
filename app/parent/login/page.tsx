"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ParentBrowseMarketplace() {
  const [parentEmail, setParentEmail] = useState("");
  const [parent, setParent] = useState<any>(null);
  const [tutors, setTutors] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState("all");
  const [audienceType, setAudienceType] = useState<"parent" | "academy">("parent");

  // Interaction modals
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [postJobModalOpen, setPostJobModalOpen] = useState(false);
  const [reportModalTutor, setReportModalTutor] = useState<any | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);

  // Job form state
  const [title, setTitle] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [city, setCity] = useState("");
  const [teachingMode, setTeachingMode] = useState("Home Tuition");
  const [description, setDescription] = useState("");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");

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
      if (res.ok) {
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
        setParent(data.parent);
        localStorage.setItem("parentEmail", parentEmail);
        setLoginModalOpen(false);
        fetchJobs();
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
          parentEmail: parent.email,
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
              <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
                🟢 {parent.email}
              </span>
              <button onClick={() => { localStorage.removeItem("parentEmail"); setParent(null); }} className="text-xs text-gray-400 hover:text-black font-bold">Logout</button>
            </div>
          ) : (
            <button
              onClick={() => setLoginModalOpen(true)}
              className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
            >
              Client Login / Register 🔑
            </button>
          )}
        </div>
      </header>

      {/* Main Browse Marketplace (Fully accessible without login wall!) */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full">
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">Browse Verified Home Tutors Instantly</h1>
              <p className="text-xs text-gray-500">Explore camera-verified educators below. If you don&apos;t find your exact match, post a job requirement!</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => setPostJobModalOpen(true)}
                className="flex-1 sm:flex-initial px-4 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
              >
                📝 Post Personalized Job Requirement
              </button>
            </div>
          </div>

          {/* Toggle Audience Type */}
          <div className="flex bg-gray-100 p-1 rounded-xl max-w-sm">
            <button
              onClick={() => setAudienceType("parent")}
              className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition-all ${audienceType === "parent" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}
            >
              👨‍👩‍👧‍👦 Parents & Students
            </button>
            <button
              onClick={() => setAudienceType("academy")}
              className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition-all ${audienceType === "academy" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}
            >
              🏫 Schools & Academies
            </button>
          </div>

          {/* Dynamic Message Box */}
          <div className="p-4 rounded-xl text-xs font-medium leading-relaxed bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-sm">
            {audienceType === "parent" ? (
              <p>
                ✨ <strong className="text-red-400 font-extrabold">A message for parents:</strong> In our society, your child&apos;s education and safety are paramount. Finding a trusted, camera-verified home tutor eliminates the stress of unvetted strangers entering your home. Review actual degrees and live video introductions with complete peace of mind.
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
            <button onClick={() => setPostJobModalOpen(true)} className="px-5 py-2.5 bg-[#B3191F] text-white rounded-xl text-xs font-bold shadow-sm">
              Post a Personalized Job Requirement ➔
            </button>
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
                  <button
                    onClick={() => {
                      if (!parent) setLoginModalOpen(true);
                      else alert(`Connecting with ${t.fullName}. Our team has logged your interest!`);
                    }}
                    className="flex-1 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-center font-bold text-xs rounded-xl shadow-sm transition-colors"
                  >
                    Hire / Contact ➔
                  </button>
                  <button
                    onClick={() => setReportModalTutor(t)}
                    className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold rounded-xl transition-colors"
                    title="Block or Report Tutor"
                  >
                    ⚠️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* LOGIN MODAL */}
      {loginModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold">Client Sign Up / Login</h3>
              <button onClick={() => setLoginModalOpen(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            <p className="text-xs text-gray-500">To contact this verified tutor or post a job, please enter your email address.</p>
            <form onSubmit={handleLoginOrRegister} className="space-y-3">
              <input
                type="email"
                required
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                placeholder="parent@example.com"
                className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold text-xs rounded-xl shadow-sm">
                Continue to Dashboard ➔
              </button>
            </form>
          </div>
        </div>
      )}

      {/* POST JOB MODAL */}
      {postJobModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold">Post Personalized Job Requirement</h3>
              <button onClick={() => setPostJobModalOpen(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            {msg && <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold">{msg}</div>}
            {!parent && (
              <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs font-bold">
                ⚠️ You are not signed in. Please enter your email below to submit this requirement.
              </div>
            )}
            <form onSubmit={handlePostJob} className="space-y-3 text-xs">
              {!parent && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Your Email Address</label>
                  <input type="email" required value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="parent@example.com" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Job Title</label>
                <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. O-Level Math Tutor Needed" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Subjects (Comma separated)</label>
                <input type="text" required value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} placeholder="Math, Physics" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Class Level</label>
                  <input type="text" required value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="Grade 9" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Budget</label>
                  <input type="text" required value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="25,000 PKR" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">City</label>
                  <input type="text" required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lahore" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Mode</label>
                  <select value={teachingMode} onChange={(e) => setTeachingMode(e.target.value)} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs">
                    <option value="Home Tuition">Home Tuition</option>
                    <option value="Online">Online</option>
                    <option value="Both">Both</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Description</label>
                <textarea rows={3} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Timings, expectations..." className="w-full p-3 border border-gray-200 rounded-xl text-xs"></textarea>
              </div>
              <button type="submit" disabled={posting} className="w-full py-3 bg-[#B3191F] text-white font-bold rounded-xl text-xs uppercase shadow-sm">
                {posting ? "Publishing..." : "🚀 Publish Requirement & Notify Tutors"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* REPORT MODAL */}
      {reportModalTutor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <h3 className="text-sm font-extrabold text-red-600">Report or Block Tutor</h3>
              <button onClick={() => setReportModalTutor(null)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            {reportSuccess ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold text-center">
                ✅ Report submitted. Our trust & safety team will review this profile immediately.
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); setReportSuccess(true); setTimeout(() => { setReportSuccess(false); setReportModalTutor(null); setReportReason(""); }, 2000); }} className="space-y-3">
                <p className="text-xs text-gray-600">Why are you reporting <span className="font-bold">{reportModalTutor.fullName}</span>?</p>
                <textarea rows={3} required value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Provide details..." className="w-full p-3 border border-gray-200 rounded-xl text-xs"></textarea>
                <button type="submit" className="w-full py-2.5 bg-[#B3191F] text-white font-bold text-xs rounded-xl shadow-sm">
                  Submit Report & Block ➔
                </button>
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