"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ParentLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/parent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      sessionStorage.setItem("parentData", JSON.stringify(data.parent));
      router.push("/parent/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-4 font-sans text-[#161616]">
      <Link href="/" className="text-3xl font-bold tracking-tight mb-8">
        Tutor<span className="text-[#B3191F]">Mint</span>
      </Link>

      <div className="bg-white max-w-md w-full rounded-xl shadow-sm border border-[#EDEDED] p-8">
        <h1 className="text-2xl font-extrabold mb-2 text-center">Parent Login</h1>
        <p className="text-gray-500 text-center mb-6 text-sm">Enter your registered email to access your account.</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:border-[#B3191F]" 
              placeholder="ahmed@example.com" 
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full py-3 bg-[#B3191F] text-white rounded-md font-bold hover:bg-red-800 transition-colors disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Access Parent Portal"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          Don't have an account? <Link href="/parent/register" className="text-[#B3191F] font-bold hover:underline">Register as Parent</Link>
        </div>
      </div>
    </div>
  );
}