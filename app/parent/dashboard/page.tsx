"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

  if (!parent) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 font-sans">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Summary Banner */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-xs font-bold text-[#B3191F] uppercase tracking-wider block mb-1">Client Workspace</span>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900 mb-1">Parent Portal</h1>
          <p className="text-gray-500 text-sm">Manage your student's profile and browse verified tutors available in your area.</p>
        </div>
        <div className="bg-red-50 border border-red-100 p-4 rounded-xl min-w-[160px]">
          <span className="text-xs font-bold text-red-700 uppercase tracking-wider block mb-1">Target Grade</span>
          <span className="text-base font-extrabold text-[#B3191F]">{parent.studentGrade}</span>
        </div>
      </div>

      {/* Verified Tutors Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 p-6 md:p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-extrabold text-gray-900">Available Verified Tutors</h2>
          <span className="text-xs font-bold px-3 py-1 bg-gray-100 text-gray-600 rounded-full">
            {tutors.length} Live Online
          </span>
        </div>

        {loadingTutors ? (
          <p className="text-gray-500 text-sm py-12 text-center">Loading verified tutors...</p>
        ) : tutors.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
            <p className="text-gray-500 text-sm font-medium mb-1">No verified tutors available yet.</p>
            <p className="text-gray-400 text-xs">Go to the admin panel to approve registered tutor applications!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {tutors.map((tutor) => (
              <div key={tutor._id} className="border border-gray-200 rounded-xl p-6 hover:border-[#B3191F] hover:shadow-md transition-all flex flex-col justify-between bg-white">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold text-gray-900">{tutor.fullName}</h3>
                    <span className="px-2.5 py-1 bg-green-100 text-green-800 text-xs font-extrabold rounded-full uppercase tracking-wide">Verified</span>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-1.5">
                    <span>📍</span> {tutor.city}, {tutor.province}
                  </p>
                  <p className="text-sm font-semibold text-gray-800 mb-1">
                    Degrees: <span className="font-normal text-gray-600">{Array.isArray(tutor.degrees) ? tutor.degrees.join(", ") : tutor.degrees}</span>
                  </p>
                  <p className="text-sm font-semibold text-gray-800 mb-6">
                    Mode: <span className="font-normal text-gray-600">{tutor.teachingMode}</span>
                  </p>
                </div>
                <button 
                  onClick={() => alert(`Connection request initiated for ${tutor.fullName}. Our team will contact you shortly!`)}
                  className="w-full py-3 bg-[#B3191F] text-white rounded-xl text-sm font-bold hover:bg-red-800 shadow-md shadow-red-900/10 transition-all"
                >
                  Hire Tutor
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}