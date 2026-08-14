"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ParentData {
  fullName: string;
  email: string;
  phone_number: string;
  city: string;
  studentGrade: string;
}

interface Tutor {
  _id: string;
  fullName: string;
  city: string;
  province: string;
  teachingMode: string;
  degrees: string[];
  onlinePlatforms: string[];
  status: string;
}

export default function ParentDashboard() {
  const router = useRouter();
  const [parent, setParent] = useState<ParentData | null>(null);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loadingTutors, setLoadingTutors] = useState(true);

  useEffect(() => {
    const data = sessionStorage.getItem("parentData");
    if (!data) {
      router.push("/parent/login");
      return;
    }
    setParent(JSON.parse(data));
    fetchApprovedTutors();
  }, [router]);

  const fetchApprovedTutors = async () => {
    try {
      const res = await fetch("/api/tutors/approved");
      const data = await res.json();
      if (res.ok) {
        setTutors(data.tutors);
      }
    } catch (err) {
      console.error("Failed to fetch tutors", err);
    } finally {
      setLoadingTutors(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("parentData");
    router.push("/parent/login");
  };

  if (!parent) {
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
          <span className="text-sm font-semibold text-gray-700">Welcome, {parent.fullName}</span>
          <button 
            onClick={handleLogout}
            className="text-sm font-bold text-[#B3191F] hover:underline"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Dashboard Body */}
      <main className="max-w-5xl mx-auto p-6 mt-6 space-y-6">
        {/* Profile Summary Banner */}
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-extrabold mb-1">Parent Portal</h1>
            <p className="text-gray-500 text-sm">Manage your student's profile and browse verified tutors available in your area.</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Target Grade</span>
            <span className="text-base font-extrabold text-[#B3191F]">{parent.studentGrade}</span>
          </div>
        </div>

        {/* Verified Tutors Section */}
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6">
          <h2 className="text-xl font-extrabold mb-4">Available Verified Tutors</h2>

          {loadingTutors ? (
            <p className="text-gray-500 text-sm py-8 text-center">Loading verified tutors...</p>
          ) : tutors.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">No verified tutors available yet. Please check back soon!</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tutors.map((tutor) => (
                <div key={tutor._id} className="border border-gray-200 rounded-lg p-5 hover:border-[#B3191F] transition-colors flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{tutor.fullName}</h3>
                      <span className="px-2.5 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full uppercase">Verified</span>
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-2">📍 {tutor.city}, {tutor.province}</p>
                    <p className="text-sm font-semibold text-gray-800 mb-1">Degrees: {Array.isArray(tutor.degrees) ? tutor.degrees.join(", ") : tutor.degrees}</p>
                    <p className="text-sm font-semibold text-gray-800 mb-4">Mode: {tutor.teachingMode}</p>
                  </div>
                  <button 
                    onClick={() => alert(`Connection request initiated for ${tutor.fullName}. Our team will contact you shortly!`)}
                    className="w-full py-2 bg-[#B3191F] text-white rounded-md text-sm font-bold hover:bg-red-800 transition-colors"
                  >
                    Hire Tutor
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}