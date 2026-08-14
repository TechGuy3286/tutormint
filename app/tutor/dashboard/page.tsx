"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TutorData {
  fullName: string;
  email: string;
  cnic: string;
  phone_number: string;
  whatsapp_number: string;
  province: string;
  city: string;
  degrees: string[];
  teachingMode: string;
  onlinePlatforms: string[];
  status: string;
  connects: number;
  balance: number;
}

export default function TutorDashboard() {
  const router = useRouter();
  const [tutor, setTutor] = useState<TutorData | null>(null);

  useEffect(() => {
    const data = sessionStorage.getItem("tutorData");
    if (!data) {
      router.push("/tutor/login");
      return;
    }
    setTutor(JSON.parse(data));
  }, [router]);

  const handleLogout = () => {
    sessionStorage.removeItem("tutorData");
    router.push("/tutor/login");
  };

  if (!tutor) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center font-sans text-gray-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Top Navbar */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
        </Link>
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-gray-700">Welcome, {tutor.fullName}</span>
          <button 
            onClick={handleLogout}
            className="text-sm font-bold text-[#B3191F] hover:underline"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Dashboard Body */}
      <main className="max-w-4xl mx-auto p-6 mt-6 space-y-6">
        {/* Status Banner */}
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-extrabold mb-1">Tutor Portal Dashboard</h1>
            <p className="text-gray-500 text-sm">Manage your profile details and track your verification status.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-600">Application Status:</span>
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
              tutor.status === 'approved' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-amber-100 text-[#F1A80A]'
            }`}>
              {tutor.status || "Pending"}
            </span>
          </div>
        </div>

        {/* Profile Details Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Full Name</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.fullName}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Email Address</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.email}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">CNIC Number</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.cnic}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Phone & WhatsApp</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.phone_number} {tutor.whatsapp_number ? `(${tutor.whatsapp_number})` : ''}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Location</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.city}, {tutor.province}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Teaching Mode</h3>
            <p className="text-base font-semibold text-gray-800">{tutor.teachingMode}</p>
          </div>
          <div className="md:col-span-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Academic Degree(s)</h3>
            <p className="text-base font-semibold text-gray-800">{Array.isArray(tutor.degrees) ? tutor.degrees.join(", ") : tutor.degrees}</p>
          </div>
          {tutor.onlinePlatforms && tutor.onlinePlatforms.length > 0 && (
            <div className="md:col-span-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Online Platforms</h3>
              <p className="text-base font-semibold text-gray-800">{Array.isArray(tutor.onlinePlatforms) ? tutor.onlinePlatforms.join(", ") : tutor.onlinePlatforms}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}