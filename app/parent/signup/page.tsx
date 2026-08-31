"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function ParentSignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const router = useRouter();
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/parent/dashboard`,
        },
      });

      if (error) throw error;

      // Temporarily store credentials to pre-fill the login form
      sessionStorage.setItem("prefill_email", email);
      sessionStorage.setItem("prefill_password", password);

      // Automatically redirect to login page
      router.push("/parent/login");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to sign up. Please try again.");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-4 sm:px-6 py-12 text-[#334155]">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-gray-200/80 shadow-xs space-y-6">
        
        <div className="text-center space-y-3">
          <Link href="/" className="inline-block">
            <Image 
              src="/logo.png" 
              alt="TutorMint Logo" 
              width={140} 
              height={40} 
              className="mx-auto object-contain h-8 w-auto"
            />
          </Link>
          <div className="space-y-1">
            <h1 className="text-xl font-black text-[#0F172A]">Create Parent Account</h1>
            <p className="text-xs text-gray-500 font-medium">
              Post job requirements and connect with verified tutors instantly.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Email Address</label>
            <input 
              type="email"
              required
              placeholder="parent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white focus:ring-4 focus:ring-[#0F172A]/5 transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Password</label>
            <input 
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white focus:ring-4 focus:ring-[#0F172A]/5 transition-all"
            />
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Creating Account...' : 'Sign Up & Continue to Login ➔'}
          </button>
        </form>

        <div className="text-center text-xs text-gray-500 pt-4 border-t border-gray-100">
          Already have an account?{" "}
          <Link href="/parent/login" className="text-[#d60008] font-bold hover:underline">
            Log In
          </Link>
        </div>

      </div>
    </main>
  );
}