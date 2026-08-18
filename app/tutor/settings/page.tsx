"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function TutorSettings() {
  const [tutorEmail, setTutorEmail] = useState("");
  const [tutor, setTutor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [formData, setFormData] = useState({
    fullName: "",
    phone_number: "",
    whatsapp_number: "",
    city: "",
    areaName: "",
    degrees: "",
    teachingMode: "Physical",
    introVideo: "",
  });

  useEffect(() => {
    const stored = localStorage.getItem("tutorEmail") || "techguy3286@gmail.com";
    setTutorEmail(stored);
    fetchTutorProfile(stored);
  }, []);

  const fetchTutorProfile = async (email: string) => {
    try {
      const res = await fetch(`/api/tutor/profile?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
        setFormData({
          fullName: data.tutor.fullName || "",
          phone_number: data.tutor.phone_number || "",
          whatsapp_number: data.tutor.whatsapp_number || "",
          city: data.tutor.city || "",
          areaName: data.tutor.areaName || "",
          degrees: data.tutor.degrees || "",
          teachingMode: data.tutor.teachingMode || "Physical",
          introVideo: data.tutor.introVideo || "",
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/tutor/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tutorEmail, ...formData }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg("✨ Profile settings updated successfully!");
      } else {
        setErrorMsg(data.error || "Failed to update profile.");
      }
    } catch (err) {
      setErrorMsg("Server error while saving settings.");
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-400 uppercase">Loading Settings...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Tutor Settings</span>
        </Link>
        <Link href="/tutor/dashboard" className="px-3.5 py-1.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-lg">
          Dashboard ➔
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 flex-1 w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-black">Tutor Profile Settings</h1>
            <p className="text-xs text-gray-500">Manage your credentials, teaching preferences, and video verification link.</p>
          </div>

          {successMsg && <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold">{successMsg}</div>}
          {errorMsg && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-xs font-bold">{errorMsg}</div>}

          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Full Name</label>
                <input type="text" value={formData.fullName} onChange={(e) => setFormData({...formData, fullName: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" required />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Email (Locked)</label>
                <input type="email" value={tutorEmail} disabled className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-400 cursor-not-allowed" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">City</label>
                <input type="text" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" required />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Area Name</label>
                <input type="text" value={formData.areaName} onChange={(e) => setFormData({...formData, areaName: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" required />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Teaching Mode</label>
                <select value={formData.teachingMode} onChange={(e) => setFormData({...formData, teachingMode: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black">
                  <option value="Physical">Physical</option>
                  <option value="Online">Online</option>
                  <option value="Both">Both</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Degrees & Qualifications</label>
              <input type="text" value={formData.degrees} onChange={(e) => setFormData({...formData, degrees: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" required />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Video Verification Link (YouTube / Drive)</label>
              <input type="text" value={formData.introVideo} onChange={(e) => setFormData({...formData, introVideo: e.target.value})} placeholder="https://..." className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black" />
            </div>

            <button type="submit" className="w-full py-3 bg-[#B3191F] text-white font-bold rounded-xl text-xs uppercase shadow-sm">
              Save Settings ➔
            </button>
          </form>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400">
        © 2026 TutorMint. Tutor Settings.
      </footer>
    </div>
  );
}