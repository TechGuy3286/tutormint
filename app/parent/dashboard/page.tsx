"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const PARENT_QUOTES = [
  "👨‍👩‍👧‍👦 Trusted by hundreds of parents for finding camera-verified home tutors.",
  "🏫 Premier matchmaking platform for schools, academies, and private clients.",
  "⚡ Verified educators with background checks and live degree verification."
];

export default function ParentDashboard() {
  const router = useRouter();
  const [parentEmail, setParentEmail] = useState("");
  const [parent, setParent] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);

  // Job form state
  const [title, setTitle] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("Punjab");
  const [teachingMode, setTeachingMode] = useState("Online");
  const [description, setDescription] = useState("");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteIdx((prev) => (prev + 1) % PARENT_QUOTES.length);
    }, 4500);

    const stored = localStorage.getItem("parentEmail");
    if (stored) {
      setParentEmail(stored);
      fetchData(stored);
    } else {
      setLoading(false);
    }

    return () => clearInterval(timer);
  }, []);

  const fetchData = async (email: string) => {
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

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/parent/jobs");
      const data = await res.json();
      if (res.ok) setJobs(data.jobs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/parent/profile?email=${parentEmail}`);
      const data = await res.json();
      if (res.ok) {
        setParent(data.parent);
        localStorage.setItem("parentEmail", parentEmail);
        fetchJobs();
      } else {
        // Auto create client profile for testing convenience
        const createRes = await fetch("/api/parent/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: parentEmail, fullName: "Client / Parent" })
        });
        if (createRes.ok) {
          setParent({ email: parentEmail, fullName: "Client / Parent" });
          localStorage.setItem("parentEmail", parentEmail);
          fetchJobs();
        } else {
          setErrorMsg("Login failed.");
        }
      }
    } catch (err) {
      setErrorMsg("Authentication error.");
    } finally {
      setLoading(false);
    }
  };

  const handlePostJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setPosting(true);
    setMsg("");
    setErrorMsg("");

    const subjects = subjectInput.split(",").map((s) => s.trim()).filter(Boolean);

    try {
      const res = await fetch("/api/parent/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentEmail,
          title,
          subjects,
          classLevel,
          budget,
          city,
          province,
          teachingMode,
          description,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg("✨ Tuition requirement posted successfully!");
        setTitle("");
        setSubjectInput("");
        setClassLevel("");
        setBudget("");
        setCity("");
        setDescription("");
        fetchJobs();
      } else {
        setErrorMsg(data.error || "Failed to post job.");
      }
    } catch (err) {
      setErrorMsg("Server error while posting job.");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-400 uppercase">Loading Portal...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      {/* Sticky Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Parent & Client Portal</span>
        </Link>
        <div className="flex items-center space-x-4">
          {parent && (
            <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
              🟢 {parent.fullName || parentEmail}
            </span>
          )}
          <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
            🏠 Home
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 my-6 space-y-8 flex-1 w-full">
        {!parent ? (
          <div className="space-y-6 max-w-lg mx-auto">
            {/* Rotating text banner for parents/students/academies */}
            <div className="bg-gradient-to-r from-gray-900 to-[#B3191F] text-white p-4 rounded-2xl text-center text-xs font-bold shadow-sm transition-all duration-500">
              {PARENT_QUOTES[quoteIdx]}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
              <div className="text-center space-y-2">
                <span className="text-3xl">👨‍👩‍👧‍👦</span>
                <h1 className="text-xl font-extrabold tracking-tight">Parent/Client Portal Login</h1>
                <p className="text-xs text-gray-500">Enter your email to post tuition requirements & hire verified tutors.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.target.value)}
                    placeholder="parent@gmail.com"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                  />
                </div>
                {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
                <button
                  type="submit"
                  className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm"
                >
                  Access Dashboard / Login →
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Post Job */}
            <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
              <div className="flex items-center gap-2">
                <span className="text-xl">📝</span>
                <h2 className="text-base font-extrabold tracking-tight">Post Tuition Requirement</h2>
              </div>

              {msg && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl">{msg}</div>}
              {errorMsg && <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

              <form onSubmit={handlePostJob} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Job Title</label>
                  <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. O-Level Math Tutor Needed" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Subjects (Comma separated)</label>
                  <input type="text" required value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} placeholder="Math, Physics" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Class Level</label>
                    <input type="text" required value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="Grade 9" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Budget</label>
                    <input type="text" required value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="25,000 PKR" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">City</label>
                    <input type="text" required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lahore" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Mode</label>
                    <select value={teachingMode} onChange={(e) => setTeachingMode(e.target.value)} className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-black">
                      <option value="Online">Online</option>
                      <option value="Home Tuition">Home Tuition</option>
                      <option value="Both">Both</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Description</label>
                  <textarea rows={3} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Timings, expectations..." className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"></textarea>
                </div>
                <button type="submit" disabled={posting} className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50">
                  {posting ? "Publishing..." : "🚀 Publish Requirement"}
                </button>
              </form>
            </div>

            {/* Right: Posted Jobs */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                <div>
                  <h2 className="text-base font-extrabold tracking-tight">Your Posted Requirements</h2>
                  <p className="text-xs text-gray-400">Review responses and applicants from verified tutors.</p>
                </div>
                <span className="px-3 py-1 bg-gray-100 font-black text-xs rounded-full">📋 {jobs.length} Active</span>
              </div>

              <div className="space-y-4">
                {jobs.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-xs">No requirements posted yet.</div>
                ) : (
                  jobs.map((job) => (
                    <div key={job._id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-sm font-extrabold text-gray-900">{job.title}</h3>
                          <p className="text-xs text-gray-400">📍 {job.city}, {job.province} • <span className="font-bold text-gray-700">{job.teachingMode}</span></p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-800 font-black text-xs rounded-full">💵 {job.budget}</span>
                      </div>
                      <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-xl">{job.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-bold text-[10px] rounded-md">🎓 {job.classLevel}</span>
                        {job.subjects?.map((sub: string, i: number) => (
                          <span key={i} className="px-2.5 py-1 bg-gray-100 text-gray-700 font-medium text-[10px] rounded-md">📚 {sub}</span>
                        ))}
                      </div>
                      <div className="border-t border-gray-100 pt-4 flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-500">👥 Applicants: {job.applicants?.length || 0} Tutors</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Status: 🟢 Active</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Animated Support Chatbot Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen && (
          <div className="mb-3 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 space-y-3 animate-in slide-in-from-bottom-5">
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <span className="text-xs font-black uppercase text-gray-800">🤖 Client Support Assistant</span>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-xl">Welcome! Need help finding the right verified tutor or posting a job requirement?</p>
            <input type="text" placeholder="Type here..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
          </div>
        )}
        <button onClick={() => setChatOpen(!chatOpen)} className="w-14 h-14 bg-[#B3191F] hover:bg-[#9a151b] text-white rounded-full shadow-2xl flex items-center justify-center text-xl transition-transform hover:scale-105">
          🤖
        </button>
      </div>

      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex justify-between items-center max-w-6xl mx-auto w-full">
        <div>© 2026 TutorMint. Parent & Client Portal.</div>
        <div className="flex space-x-6 text-gray-400 font-medium text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/support" className="hover:text-gray-600">Support</Link>
        </div>
      </footer>
    </div>
  );
}