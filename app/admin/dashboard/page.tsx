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
        setActionMsg(`✨ Tutor ${email} status updated to: ${status}`);
        fetchAdminData();
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-6 font-sans">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <span className="text-3xl">🛡️</span>
            <h1 className="text-xl font-extrabold tracking-tight">Admin Portal Access</h1>
            <p className="text-xs text-gray-400">Enter secure administrator password to continue.</p>
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
              />
            </div>
            {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
            <button
              type="submit"
              className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm"
            >
              Authenticate Securely →
            </button>
          </form>
          <div className="text-center">
            <Link href="/" className="text-xs text-gray-400 hover:text-black font-semibold">← Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Sleek Modern Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider">Admin Control Center</span>
        </Link>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-full flex items-center gap-1.5">
            🟢 Admin Authenticated
          </span>
          <button
            onClick={handleLogout}
            className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 mt-6 space-y-8">
        {actionMsg && <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl shadow-xs">{actionMsg}</div>}
        {errorMsg && <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl shadow-xs">{errorMsg}</div>}

        {/* Quick Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Total Tutors</p>
              <h3 className="text-2xl font-black text-gray-900 mt-1">{tutors.length}</h3>
            </div>
            <span className="text-3xl bg-blue-50 p-3 rounded-2xl">👨‍🏫</span>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Active Tuition Jobs</p>
              <h3 className="text-2xl font-black text-gray-900 mt-1">{jobs.length}</h3>
            </div>
            <span className="text-3xl bg-emerald-50 p-3 rounded-2xl">📋</span>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">System Status</p>
              <h3 className="text-xs font-extrabold text-emerald-600 mt-2 flex items-center gap-1.5">🟢 Fully Operational</h3>
            </div>
            <span className="text-3xl bg-amber-50 p-3 rounded-2xl">⚡</span>
          </div>
        </div>

        {/* Tutors Management Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Registered Tutors & Verification Review</h2>
              <p className="text-xs text-gray-400">Review degree intro videos, update verification statuses, and adjust application credits.</p>
            </div>
            <button
              onClick={fetchAdminData}
              className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
            >
              🔄 Refresh Data
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs font-bold text-gray-400 uppercase tracking-widest">Loading Tutors...</div>
          ) : tutors.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-xs">No tutors registered in the database yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                    <th className="py-3 px-4">Tutor Details</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Video Intro</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Credits</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {tutors.map((t) => (
                    <tr key={t._id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-4">
                        <div className="font-extrabold text-gray-900">{t.fullName}</div>
                        <div className="text-gray-400 text-[11px]">{t.email} • {t.phone_number}</div>
                      </td>
                      <td className="py-4 px-4 font-medium text-gray-600">
                        {t.city}, {t.province}
                      </td>
                      <td className="py-4 px-4">
                        {t.introVideo ? (
                          <a href={t.introVideo} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold underline hover:text-blue-800">
                            ▶ View Video
                          </a>
                        ) : (
                          <span className="text-gray-400 italic">Not Uploaded</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                          t.profileCompletionStatus === "verified" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                        }`}>
                          {t.profileCompletionStatus || "incomplete"}
                        </span>
                      </td>
                      <td className="py-4 px-4 font-black text-gray-900">
                        ⚡ {t.connectsBalance ?? t.connects ?? 15}
                      </td>
                      <td className="py-4 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleVerifyTutor(t.email, "verified")}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors text-[10px]"
                        >
                          Verify ✓
                        </button>
                        <button
                          onClick={() => handleUpdateCredits(t.email, 15)}
                          className="px-2.5 py-1 bg-gray-900 hover:bg-black text-white font-bold rounded-lg transition-colors text-[10px]"
                        >
                          +15 Credits
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}