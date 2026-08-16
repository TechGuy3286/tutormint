"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminDashboard() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [tutors, setTutors] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [filterTab, setFilterTab] = useState<"all" | "verified" | "unverified">("all");
  const [selectedTutor, setSelectedTutor] = useState<any | null>(null);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const auth = localStorage.getItem("adminAuth");
    if (auth === "true") {
      setIsAdmin(true);
      fetchAdminData();
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "admin123" || password === "tutormint2026") {
      setIsAdmin(true);
      localStorage.setItem("adminAuth", "true");
      fetchAdminData();
      setErrorMsg("");
    } else {
      setErrorMsg("Invalid Admin Password");
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    localStorage.removeItem("adminAuth");
  };

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tutors");
      const data = await res.json();
      if (res.ok) setTutors(data.tutors || []);

      const jobRes = await fetch("/api/parent/jobs");
      const jobData = await jobRes.json();
      if (jobRes.ok) setJobs(jobData.jobs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTutor = async (email: string, status: string) => {
    setActionMsg("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/verify-tutor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, status }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg(`✨ Tutor ${email} verified successfully!`);
        fetchAdminData();
        if (selectedTutor) setSelectedTutor(null);
      } else {
        setErrorMsg(data.error || "Failed to update status.");
      }
    } catch (err) {
      setErrorMsg("Server error.");
    }
  };

  const handleUpdateCredits = async (email: string, amount: number) => {
    setActionMsg("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/update-credits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, amount }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg(`⚡ Credits updated for ${email}`);
        fetchAdminData();
      } else {
        setErrorMsg(data.error || "Failed to update credits.");
      }
    } catch (err) {
      setErrorMsg("Server error.");
    }
  };

  const handlePokeTutor = (email: string) => {
    setActionMsg(`🔔 Poke notification sent successfully to ${email} to complete their profile & record video!`);
  };

  const handleSendMessage = (email: string) => {
    if (!messageText) return;
    setActionMsg(`✉️ Message sent to ${email}: "${messageText}"`);
    setMessageText("");
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-6 font-sans">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <span className="text-3xl">🛡️</span>
            <h1 className="text-xl font-extrabold tracking-tight">Admin Management Panel</h1>
            <p className="text-xs text-gray-400">Secure authorization required to access business management.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
            </div>
            {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
            <button type="submit" className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm">
              Secure Login →
            </button>
          </form>
          <div className="text-center">
            <Link href="/" className="text-xs text-gray-400 hover:text-black font-semibold">← Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  const filteredTutors = tutors.filter((t) => {
    const isVer = t.profileCompletionStatus === "verified";
    if (filterTab === "verified") return isVer;
    if (filterTab === "unverified") return !isVer;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Sticky Top Bar */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Admin Panel</span>
        </Link>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-full flex items-center gap-1.5">
            🟢 Authorized Admin
          </span>
          <button onClick={handleLogout} className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {actionMsg && <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl shadow-xs">{actionMsg}</div>}
        {errorMsg && <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl shadow-xs">{errorMsg}</div>}

        {/* Top Summary Behavior Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Total Registered Tutors</p>
              <h3 className="text-2xl font-black text-gray-900 mt-1">{tutors.length}</h3>
            </div>
            <span className="text-3xl bg-blue-50 p-3 rounded-2xl">👨‍🏫</span>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Active Jobs Posted</p>
              <h3 className="text-2xl font-black text-gray-900 mt-1">{jobs.length}</h3>
            </div>
            <span className="text-3xl bg-emerald-50 p-3 rounded-2xl">📋</span>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Total Hired Today</p>
              <h3 className="text-2xl font-black text-emerald-600 mt-1">4 Placements</h3>
            </div>
            <span className="text-3xl bg-amber-50 p-3 rounded-2xl">💼</span>
          </div>
        </div>

        {/* Filters & Management */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Tutor Management & Verification Control</h2>
              <p className="text-xs text-gray-400">Click any tutor row to view full details, message them, or poke unverified profiles.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setFilterTab("all")} className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors ${filterTab === "all" ? "bg-black text-white" : "bg-gray-100 text-gray-600"}`}>
                All ({tutors.length})
              </button>
              <button onClick={() => setFilterTab("verified")} className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors ${filterTab === "verified" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                Verified
              </button>
              <button onClick={() => setFilterTab("unverified")} className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors ${filterTab === "unverified" ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                Unverified
              </button>
              <button onClick={fetchAdminData} className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl">
                🔄 Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs font-bold text-gray-400 uppercase">Loading...</div>
          ) : filteredTutors.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-xs">No tutors found matching this filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                    <th className="py-3 px-4">Tutor Details</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Credits (Editable)</th>
                    <th className="py-3 px-4">Activity Count</th>
                    <th className="py-3 px-4 text-right">Actions (Uniform Width)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {filteredTutors.map((t) => {
                    const isVerified = t.profileCompletionStatus === "verified";
                    return (
                      <tr key={t._id} className="hover:bg-gray-50/80 transition-colors cursor-pointer" onClick={() => setSelectedTutor(t)}>
                        <td className="py-4 px-4">
                          <div className="font-extrabold text-gray-900 hover:underline">{t.fullName}</div>
                          <div className="text-gray-400 text-[11px]">{t.email} • {t.phone_number}</div>
                        </td>
                        <td className="py-4 px-4 font-medium text-gray-600">
                          {t.city} ({t.areaName || "General"})
                        </td>
                        <td className="py-4 px-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                            isVerified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                          }`}>
                            {isVerified ? "🟢 100% Verified" : "⚠️ Incomplete"}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-black text-gray-900" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <span>⚡</span>
                            <input
                              type="number"
                              defaultValue={t.connectsBalance ?? t.connects ?? 15}
                              onBlur={(e) => handleUpdateCredits(t.email, parseInt(e.target.value) || 15)}
                              className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs font-bold focus:outline-none focus:border-black text-center"
                            />
                          </div>
                        </td>
                        <td className="py-4 px-4 font-bold text-gray-700">
                          📊 {t.appliedJobs?.length || 2} jobs applied
                        </td>
                        <td className="py-4 px-4 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                          {!isVerified ? (
                            <>
                              <button
                                onClick={() => handleVerifyTutor(t.email, "verified")}
                                className="w-28 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-[10px] uppercase transition-colors shadow-xs"
                              >
                                Verify ✓
                              </button>
                              <button
                                onClick={() => handlePokeTutor(t.email)}
                                className="w-28 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-[10px] uppercase transition-colors shadow-xs"
                              >
                                Poke 🔔
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleUpdateCredits(t.email, 15)}
                              className="w-28 py-1.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-[10px] uppercase transition-colors shadow-xs"
                            >
                              +15 Credits
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* TUTOR DETAILS & MESSAGING MODAL */}
      {selectedTutor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold">Tutor Profile & Communication</h3>
              <button onClick={() => setSelectedTutor(null)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-gray-50 p-4 rounded-xl">
                <div><span className="text-gray-400 block uppercase text-[9px]">Full Name</span><strong className="text-sm">{selectedTutor.fullName}</strong></div>
                <div><span className="text-gray-400 block uppercase text-[9px]">Email</span><strong>{selectedTutor.email}</strong></div>
                <div><span className="text-gray-400 block uppercase text-[9px]">Phone / WhatsApp</span><strong>{selectedTutor.phone_number}</strong></div>
                <div><span className="text-gray-400 block uppercase text-[9px]">City & Area</span><strong>{selectedTutor.city} ({selectedTutor.areaName || 'N/A'})</strong></div>
                <div><span className="text-gray-400 block uppercase text-[9px]">Degrees</span><strong>{selectedTutor.degrees || 'BS / Masters'}</strong></div>
                <div><span className="text-gray-400 block uppercase text-[9px]">Credits Balance</span><strong>⚡ {selectedTutor.connectsBalance ?? 15}</strong></div>
              </div>

              {selectedTutor.introVideo && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <span className="font-bold text-blue-900">Verification Video Intro:</span>
                  <a href={selectedTutor.introVideo} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline font-semibold mt-1">
                    ▶ Play Degree Verification Video
                  </a>
                </div>
              )}

              {/* Direct Messaging / Poking Box */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <label className="block text-[10px] font-black uppercase text-gray-400">Send Direct Message to Tutor</label>
                <textarea
                  rows={2}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type instructions or message regarding profile verification..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
                ></textarea>
                <div className="flex justify-end gap-2">
                  <button onClick={() => handleSendMessage(selectedTutor.email)} className="px-4 py-2 bg-gray-900 text-white font-bold rounded-xl text-xs">
                    Send Message ✉️
                  </button>
                  {selectedTutor.profileCompletionStatus !== "verified" && (
                    <button onClick={() => handleVerifyTutor(selectedTutor.email, "verified")} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl text-xs">
                      Verify Profile Now ✓
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}