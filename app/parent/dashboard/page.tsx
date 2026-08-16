"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ParentDashboard() {
  const router = useRouter();
  const [parentEmail, setParentEmail] = useState("");
  const [parent, setParent] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state for posting a new job
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
    const stored = localStorage.getItem("parentEmail");
    if (stored) {
      setParentEmail(stored);
      fetchData(stored);
    } else {
      setLoading(false);
    }
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
        setErrorMsg("Parent account not found. Please register or check email.");
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
        setErrorMsg(data.error || "Failed to post tuition job.");
      }
    } catch (err) {
      setErrorMsg("Server error while posting job.");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-400 uppercase tracking-widest">Loading Portal...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Sleek Modern Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider">Parent Portal</span>
        </Link>
        <div className="flex items-center space-x-4">
          {parent && (
            <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full flex items-center gap-1.5">
              🟢 {parent.fullName || parentEmail}
            </span>
          )}
          <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
            🏠 Home
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 mt-6 space-y-8">
        {!parent ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg mx-auto space-y-6">
            <div className="text-center space-y-2">
              <span className="text-3xl">👨‍👩‍👧‍👦</span>
              <h1 className="text-xl font-extrabold tracking-tight">Parent Login</h1>
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
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-colors"
                />
              </div>
              {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
              <button
                type="submit"
                className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm"
              >
                Access Dashboard →
              </button>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Post New Tuition Requirement */}
            <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
              <div className="flex items-center gap-2">
                <span className="text-xl">📝</span>
                <h2 className="text-base font-extrabold tracking-tight">Post Tuition Job</h2>
              </div>

              {msg && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl">{msg}</div>}
              {errorMsg && <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

              <form onSubmit={handlePostJob} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Job Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. O-Level Math Tutor Needed"
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Subjects (Comma separated)</label>
                  <input
                    type="text"
                    required
                    value={subjectInput}
                    onChange={(e) => setSubjectInput(e.target.value)}
                    placeholder="Math, Physics, Chemistry"
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Class Level</label>
                    <input
                      type="text"
                      required
                      value={classLevel}
                      onChange={(e) => setClassLevel(e.target.value)}
                      placeholder="Grade 9 / O-Level"
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Budget / Salary</label>
                    <input
                      type="text"
                      required
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="e.g. 25,000 PKR / mo"
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Lahore"
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Mode</label>
                    <select
                      value={teachingMode}
                      onChange={(e) => setTeachingMode(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-black"
                    >
                      <option value="Online">💻 Online</option>
                      <option value="Home Tuition">🏠 Home Tuition</option>
                      <option value="Both">🌐 Both</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Description & Requirements</label>
                  <textarea
                    rows={3}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Specify timing, student gender, teaching style..."
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                  ></textarea>
                </div>

                <button
                  type="submit"
                  disabled={posting}
                  className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50"
                >
                  {posting ? "Publishing..." : "🚀 Publish Job Requirement"}
                </button>
              </form>
            </div>

            {/* Right: Active Posted Jobs & Applicants */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                <div>
                  <h2 className="text-base font-extrabold tracking-tight">Your Posted Requirements</h2>
                  <p className="text-xs text-gray-400">Review responses and applicants from verified tutors.</p>
                </div>
                <span className="px-3 py-1 bg-gray-100 font-black text-xs rounded-full">
                  📋 {jobs.length} Active
                </span>
              </div>

              <div className="space-y-4">
                {jobs.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-xs">
                    No tuition requirements posted yet. Use the form on the left to publish your first job!
                  </div>
                ) : (
                  jobs.map((job) => (
                    <div key={job._id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-sm font-extrabold text-gray-900">{job.title}</h3>
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            📍 {job.city}, {job.province} • <span className="font-bold text-gray-700">{job.teachingMode}</span>
                          </p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-800 font-black text-xs rounded-full">
                          💵 {job.budget}
                        </span>
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
    </div>
  );
}