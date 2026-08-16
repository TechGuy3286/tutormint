"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TutorRegister() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("Punjab");
  const [teachingMode, setTeachingMode] = useState("Both");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/tutor/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone_number: phone,
          city,
          province,
          teachingMode,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("tutorEmail", email);
        router.push("/tutor/dashboard");
      } else {
        setErrorMsg(data.error || "Registration failed.");
      }
    } catch (err) {
      setErrorMsg("Server error during registration.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-center items-center p-6">
      <div className="mb-6">
        <Link href="/" className="text-3xl font-black tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
        </Link>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-lg w-full space-y-6">
        <div className="text-center space-y-1">
          <span className="text-3xl">👨‍🏫</span>
          <h1 className="text-xl font-extrabold tracking-tight">Tutor Registration</h1>
          <p className="text-xs text-gray-400">Create your profile and claim your starting 15 application credits.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ali Sabeer"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tutor@gmail.com"
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Phone & WhatsApp</label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="03211045245"
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">City</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Lahore"
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Teaching Mode</label>
              <select
                value={teachingMode}
                onChange={(e) => setTeachingMode(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-black"
              >
                <option value="Online">💻 Online</option>
                <option value="Home Tuition">🏠 Home Tuition</option>
                <option value="Both">🌐 Both</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? "Registering..." : "Complete Registration & Get 15 Credits ⚡"}
          </button>
        </form>

        <div className="text-center text-xs text-gray-400">
          Already registered?{" "}
          <Link href="/tutor/login" className="text-[#B3191F] font-bold hover:underline">
            Login to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}