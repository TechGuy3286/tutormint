"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TutorLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/tutor/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("tutorEmail", email);
        router.push("/tutor/dashboard");
      } else {
        setErrorMsg(data.error || "Login failed. Please check your email.");
      }
    } catch (err) {
      setErrorMsg("Server error during login. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-center items-center p-6 font-sans text-[#161616]">
      <div className="mb-6">
        <Link href="/" className="text-3xl font-extrabold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
        </Link>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-center mb-1">Tutor Portal Login</h1>
          <p className="text-gray-500 text-xs text-center">Enter your registered email address to access your dashboard.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. tutor@gmail.com"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Access Dashboard"}
          </button>
        </form>

        <div className="text-center text-xs text-gray-500">
          Don't have a profile yet?{" "}
          <Link href="/tutor/register" className="text-[#B3191F] font-bold hover:underline">
            Register as Tutor
          </Link>
        </div>
      </div>
    </div>
  );
}