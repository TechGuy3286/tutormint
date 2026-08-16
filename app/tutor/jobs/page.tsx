"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function TutorJobMarket() {
  const [email, setEmail] = useState("");
  const [tutor, setTutor] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/tutor/profile?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
        fetchJobs();
      } else {
        setErrorMsg(data.error || "Tutor profile not found.");
      }
    } catch (err) {
      setErrorMsg("Failed to authenticate session.");
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/parent/jobs");
      const data = await res.json();
      if (res.ok) {
        setJobs(data.jobs);
      }
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    }
  };

  const handleApply = async (jobId: string) => {
    setApplyingId(jobId);
    setMsg("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/tutor/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorEmail: email, jobId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        // Refresh tutor profile to update remaining connects balance
        const profileRes = await fetch(`/api/tutor/profile?email=${email}`);
        const profileData = await profileRes.json();
        if (profileRes.ok) setTutor(profileData.tutor);
        fetchJobs();
      } else {
        setErrorMsg(data.error || "Failed to apply.");
      }
    } catch (err) {
      setErrorMsg("Server error during application.");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Job Market</span>
        </Link>
        {tutor && (
          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
              ⚡ Connects Balance: {tutor.connectsBalance}
            </span>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto p-6 mt-6 space-y-6">
        {!tutor ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h1 className="text-2xl font-extrabold mb-2">Tutor Job Market Access</h1>
            <p className="text-gray-500 text-sm mb-6">Enter your registered email address to view available tuitions and apply using your connects.</p>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Registered Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. tutor@gmail.com"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                />
              </div>
              {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                {loading ? "Authenticating..." : "Open Job Market"}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status & Verification Alert */}
            {tutor.profileCompletionStatus !== "verified" ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-2xl text-xs font-bold flex justify-between items-center">
                <span>⚠️ Your profile is currently '{tutor.profileCompletionStatus}'. You must be 100% verified by admin to apply for tuition jobs.</span>
                <Link href="/tutor/complete-profile" className="underline font-extrabold">Complete Profile →</Link>
              </div>
            ) : (
              <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-2xl text-xs font-bold flex justify-between items-center">
                <span>✅ Profile 100% Verified! You can apply to any tuition job below (costs 3 connects per application).</span>
              </div>
            )}

            {msg && <div className="p-4 bg-green-50 border border-green-200 text-green-800 text-xs font-bold rounded-xl">{msg}</div>}
            {errorMsg && <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

            <h2 className="text-xl font-extrabold text-gray-900">Available Tuition Opportunities ({jobs.length})</h2>

            <div className="space-y-4">
              {jobs.length === 0 ? (
                <p className="text-center py-12 text-gray-500 text-sm bg-white rounded-2xl border border-gray-200">No active tuition jobs posted right now. Check back soon!</p>
              ) : (
                jobs.map((job) => (
                  <div key={job._id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{job.title}</h3>
                        <p className="text-xs text-gray-500">{job.city}, {job.province} • <span className="font-semibold">{job.teachingMode}</span></p>
                      </div>
                      <span className="px-3 py-1 bg-gray-100 text-gray-900 font-black text-xs rounded-full">
                        💰 {job.budget}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700">{job.description}</p>

                    <div className="flex flex-wrap gap-2">
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-800 font-bold text-xs rounded-md">Class: {job.classLevel}</span>
                      {job.subjects.map((sub: string, i: number) => (
                        <span key={i} className="px-2.5 py-1 bg-gray-100 text-gray-700 font-medium text-xs rounded-md">{sub}</span>
                      ))}
                    </div>

                    <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
                      <span className="text-xs text-gray-400">Applicants: {job.applicants?.length || 0}</span>
                      <button
                        onClick={() => handleApply(job._id)}
                        disabled={applyingId === job._id || tutor.profileCompletionStatus !== "verified" || tutor.connectsBalance < 3}
                        className="px-5 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors shadow-sm disabled:opacity-50"
                      >
                        {applyingId === job._id ? "Applying..." : "Apply Now (Cost: 3 Connects)"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}