"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ParentDashboard() {
  const [parentEmail, setParentEmail] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // New Job Form State
  const [title, setTitle] = useState("");
  const [subjects, setSubjects] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [city, setCity] = useState("Lahore");
  const [province, setProvince] = useState("Punjab");
  const [teachingMode, setTeachingMode] = useState("Physical");
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentEmail) return;
    setIsLoggedIn(true);
    fetchParentJobs();
  };

  const fetchParentJobs = async () => {
    try {
      const res = await fetch("/api/parent/jobs");
      const data = await res.json();
      if (res.ok) {
        // Filter jobs posted by this parent (or show all active if demo)
        const myJobs = data.jobs.filter((j: any) => j.parentEmail === parentEmail || !parentEmail);
        setJobs(myJobs);
      }
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    }
  };

  const handlePostJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/parent/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentEmail,
          title,
          subjects,
          classLevel,
          city,
          province,
          teachingMode,
          budget,
          description,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMsg("Tuition job posted successfully!");
        setTitle("");
        setSubjects("");
        setClassLevel("");
        setBudget("");
        setDescription("");
        fetchParentJobs();
      } else {
        setErrorMsg(data.error || "Failed to post job.");
      }
    } catch (err) {
      setErrorMsg("Server error while posting job.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Parent Portal</span>
        </Link>
        {isLoggedIn && <span className="text-xs font-semibold text-gray-600">Logged in as: {parentEmail}</span>}
      </header>

      <main className="max-w-5xl mx-auto p-6 mt-6 space-y-8">
        {!isLoggedIn ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg mx-auto">
            <h1 className="text-2xl font-extrabold mb-2">Parent Dashboard Login</h1>
            <p className="text-gray-500 text-sm mb-6">Enter your email address to manage your tuition postings and review applicants.</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Parent Email</label>
                <input
                  type="email"
                  required
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  placeholder="e.g. parent@gmail.com"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
              >
                Access Parent Dashboard
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Post Job Form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-extrabold mb-1">Post a New Tuition Requirement</h2>
              <p className="text-gray-500 text-sm mb-6">Verified tutors on TutorMint will be able to view and apply to your requirement.</p>

              {msg && <div className="mb-4 p-4 bg-green-50 text-green-800 text-xs font-bold rounded-xl">{msg}</div>}
              {errorMsg && <div className="mb-4 p-4 bg-red-50 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

              <form onSubmit={handlePostJob} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Job Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Urgent O-Level Mathematics Tutor Needed in DHA"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Subjects (comma-separated)</label>
                  <input
                    type="text"
                    required
                    value={subjects}
                    onChange={(e) => setSubjects(e.target.value)}
                    placeholder="Math, Physics, Chemistry"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Class Level</label>
                  <input
                    type="text"
                    required
                    value={classLevel}
                    onChange={(e) => setClassLevel(e.target.value)}
                    placeholder="e.g. Grade 9 / O-Levels"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">City</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Teaching Mode</label>
                  <select
                    value={teachingMode}
                    onChange={(e) => setTeachingMode(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black bg-white"
                  >
                    <option value="Physical">Physical (Home Tuition)</option>
                    <option value="Online">Online Tuition</option>
                    <option value="Both">Both (Physical & Online)</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Budget / Salary Offer</label>
                  <input
                    type="text"
                    required
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="e.g. PKR 30,000 / month"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Detailed Requirements & Timings</label>
                  <textarea
                    required
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Specify timings, gender preference for tutor, exact location details, etc."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                  ></textarea>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                  >
                    {loading ? "Posting..." : "Publish Tuition Requirement"}
                  </button>
                </div>
              </form>
            </div>

            {/* My Posted Jobs & Applicants */}
            <div className="space-y-4">
              <h2 className="text-xl font-extrabold text-gray-900">Your Posted Tuition Jobs & Applicants</h2>
              {jobs.length === 0 ? (
                <p className="text-center py-12 text-gray-500 text-sm bg-white rounded-2xl border border-gray-200">You have not posted any tuition jobs yet.</p>
              ) : (
                jobs.map((job) => (
                  <div key={job._id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{job.title}</h3>
                        <p className="text-xs text-gray-500">{job.city} • <span className="font-semibold">{job.teachingMode}</span></p>
                      </div>
                      <span className="px-3 py-1 bg-gray-100 text-gray-900 font-black text-xs rounded-full">
                        💰 {job.budget}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700">{job.description}</p>

                    {/* Applicants List */}
                    <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase text-gray-400 tracking-wider">
                        Applied Tutors ({job.applicants?.length || 0})
                      </h4>
                      {job.applicants?.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No tutors have applied to this listing yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {job.applicants.map((app: any, idx: number) => (
                            <div key={idx} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100 text-sm">
                              <div>
                                <span className="font-bold text-gray-900">{app.tutorName}</span>
                                <span className="text-xs text-gray-500 block">{app.tutorEmail}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs font-bold text-blue-600 block">⚡ Connects Spent: {app.connectsSpent}</span>
                                <span className="text-[10px] text-gray-400">{new Date(app.appliedAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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