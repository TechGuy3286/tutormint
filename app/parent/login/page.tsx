"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function ParentLoginPage() {
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrPhone.trim()) {
      alert("Please enter your email or phone number.");
      return;
    }

    // Simulate successful login/signup by setting the token
    localStorage.setItem("parentToken", "active_session");
    
    // Redirect back to the browse tutors dashboard
    router.push("/parent/dashboard");
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#000000] flex flex-col justify-between relative">
      {/* Consistent Navbar */}
      <Navbar />

      {/* Main Container */}
      <main className="max-w-md mx-auto px-4 py-16 flex-1 w-full flex items-center justify-center">
        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm w-full space-y-6">
          
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-black text-[#000000]">Parent Portal Login</h1>
            <p className="text-xs text-gray-500 font-medium">
              Sign in or create an account instantly to contact verified tutors and post jobs.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#1f1f7a] block">Email or Phone Number</label>
              <input
                type="text"
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                placeholder="e.g., 03001234567 or parent@gmail.com"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-[#1f1f7a] focus:bg-white transition-all"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-extrabold rounded-xl shadow-md shadow-[#d60008]/20 transition-all flex items-center justify-center gap-2"
            >
              <span>Continue to Tutors Portal ➔</span>
            </button>
          </form>

          <div className="text-center pt-2 border-t border-gray-100">
            <p className="text-[11px] text-gray-500">
              Are you an educator? <a href="/tutor/login" className="text-[#1f1f7a] font-bold hover:underline">Tutor Login here</a>
            </p>
          </div>

        </div>
      </main>

      {/* Consistent Footer */}
      <Footer />
    </div>
  );
}