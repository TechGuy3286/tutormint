"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ParentLogin() {
  const router = useRouter();
  const [parentEmail, setParentEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/parent/profile?email=${parentEmail}`);
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("parentEmail", parentEmail);
        router.push("/parent/dashboard");
      } else {
        // Auto-create client profile for instant testing convenience
        const createRes = await fetch("/api/parent/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: parentEmail, fullName: "Client / Parent" })
        });
        if (createRes.ok) {
          localStorage.setItem("parentEmail", parentEmail);
          router.push("/parent/dashboard");
        } else {
          setErrorMsg("Failed to authenticate client profile.");
        }
      }
    } catch (err) {
      setErrorMsg("Server error during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Parent & Client Portal</span>
        </Link>
        <Link href="/" className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg">
          🏠 Home
        </Link>
      </header>

      <main className="max-w-md mx-auto p-6 my-auto w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <span className="text-3xl">👨‍👩‍👧‍👦</span>
            <h1 className="text-xl font-extrabold tracking-tight">Parent / Client Portal Login</h1>
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
                placeholder="parent@example.com"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
            </div>
            {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? "Authenticating..." : "Access Parent Dashboard →"}
            </button>
          </form>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400">
        © 2026 TutorMint. Parent & Client Portal.
      </footer>
    </div>
  );
}