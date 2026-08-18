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

  // Interaction modals & state
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [postJobModalOpen, setPostJobModalOpen] = useState(false);
  const [reportModalTutor, setReportModalTutor] = useState<any | null>(null);
  const [pendingTutor, setPendingTutor] = useState<any | null>(null); // Added missing state
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
        setParent(data.parent);
        localStorage.setItem("parentEmail", parentEmail);
        setLoginModalOpen(false);
        fetchJobs();
        
        // Success logic fix
        if (pendingTutor) {
          setSuccessModalMsg(`🎉 Success! Your contact request for ${pendingTutor.fullName} has been logged. Our team will connect you shortly.`);
          setPendingTutor(null);
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
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Client Marketplace</span>
        </Link>
        <div className="flex items-center space-x-3">
          {parent ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">🟢 {parent.email}</span>
              <button onClick={() => { localStorage.removeItem("parentEmail"); setParent(null); }} className="text-xs text-gray-400 hover:text-black font-bold">Logout</button>
            </div>
          ) : (
            <button onClick={() => setLoginModalOpen(true)} className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-sm">Client Login / Register 🔑</button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full">
        {successModalMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-extrabold flex justify-between items-center shadow-sm">
            <span>{successModalMsg}</span>
            <button onClick={() => setSuccessModalMsg("")} className="text-emerald-700 font-bold ml-4">✕</button>
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">Browse Verified Home Tutors</h1>
          <button onClick={() => setPostJobModalOpen(true)} className="px-4 py-2.5 bg-[#B3191F] text-white text-xs font-bold rounded-xl">📝 Post Personalized Job Requirement</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTutors.map((t) => (
            <div key={t._id} className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col justify-between">
              <h3 className="text-base font-black">{t.fullName}</h3>
              <p className="text-xs text-gray-500 mb-4">📍 {t.city}</p>
              <button onClick={() => handleHireClick(t)} className="w-full py-2 bg-[#B3191F] text-white text-xs font-bold rounded-xl">Hire / Contact ➔</button>
            </div>
          ))}
        </div>
      </main>

      {loginModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-sm font-extrabold">Client Login</h3>
            <form onSubmit={handleLoginOrRegister} className="space-y-3">
              <input type="email" required value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="parent@example.com" className="w-full p-3 border border-gray-200 rounded-xl text-xs" />
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold text-xs rounded-xl">Continue to Dashboard ➔</button>
            </form>
          </div>
        </div>
      )}

      {postJobModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-sm font-extrabold">Post Job</h3>
            <form onSubmit={handlePostJob} className="space-y-3 text-xs">
              <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full p-3 border border-gray-200 rounded-xl" />
              <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold rounded-xl">Publish 🚀</button>
            </form>
          </div>
        </div>
      )}

      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400">
        © 2026 TutorMint. All rights reserved. Client Marketplace.
      </footer>
    </div>
  );
}