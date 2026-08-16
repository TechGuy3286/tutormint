"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Tutor {
  _id: string;
  fullName: string;
  email: string;
  phone_number: string;
  whatsapp?: string;
  cnic?: string;
  city: string;
  province: string;
  teachingMode: string;
  degrees: string[] | string;
  subjects?: string[] | string;
  experience?: string;
  status: string; // Sign-up status
  profileCompletionStatus: string; // 'incomplete' | 'pending_verification' | 'verified'
  introVideo?: string;
  connectsBalance: number;
  createdAt: string;
  [key: string]: any;
}

export default function AdminDashboard() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedTutor, setSelectedTutor] = useState<Tutor | null>(null);

  useEffect(() => {
    fetchTutors();
  }, []);

  const fetchTutors = async () => {
    try {
      const res = await fetch("/api/admin/tutors");
      const data = await res.json();
      if (res.ok) {
        setTutors(data.tutors);
      }
    } catch (err) {
      console.error("Failed to fetch tutors", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (tutorId: string, newStatus: string) => {
    setActionLoading(tutorId);
    try {
      const res = await fetch("/api/admin/tutor/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, status: newStatus }),
      });
      const data = await res.json();
      if (res.ok) {
        setTutors(tutors.map((t) => (t._id === tutorId ? { ...t, status: newStatus } : t)));
        if (selectedTutor && selectedTutor._id === tutorId) {
          setSelectedTutor({ ...selectedTutor, status: newStatus });
        }
      } else {
        alert(data.error || "Failed to update status");
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleProfileVerification = async (tutorId: string, newProfileStatus: string) => {
    setActionLoading(tutorId);
    try {
      const res = await fetch("/api/admin/tutor/verify-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, profileCompletionStatus: newProfileStatus }),
      });
      const data = await res.json();
      if (res.ok) {
        setTutors(tutors.map((t) => (t._id === tutorId ? { ...t, profileCompletionStatus: newProfileStatus } : t)));
        if (selectedTutor && selectedTutor._id === tutorId) {
          setSelectedTutor({ ...selectedTutor, profileCompletionStatus: newProfileStatus });
        }
      } else {
        alert(data.error || "Failed to update profile verification");
      }
    } catch (err) {
      console.error("Error updating profile verification:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Admin Portal</span>
        </Link>
        <span className="text-sm font-semibold text-gray-600">Platform Management & Verification</span>
      </header>

      <main className="max-w-7xl mx-auto p-6 mt-6 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6">
          <h1 className="text-2xl font-extrabold mb-1">Tutor Applications & Verifications</h1>
          <p className="text-gray-500 text-sm mb-6">Review tutor registrations, inspect their YouTube 60s video introductions & degree showcases, and verify profiles.</p>

          {loading ? (
            <p className="text-center py-12 text-gray-500 text-sm">Loading tutors...</p>
          ) : tutors.length === 0 ? (
            <p className="text-center py-12 text-gray-500 text-sm">No tutor applications found in the database.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Tutor Details</th>
                    <th className="py-3 px-4">Location & Mode</th>
                    <th className="py-3 px-4">Video Intro</th>
                    <th className="py-3 px-4">Profile Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {tutors.map((tutor) => (
                    <tr key={tutor._id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-4">
                        <button 
                          onClick={() => setSelectedTutor(tutor)}
                          className="font-bold text-blue-600 hover:underline text-left"
                        >
                          {tutor.fullName}
                        </button>
                        <div className="text-xs text-gray-500">{tutor.email}</div>
                        <div className="text-xs text-gray-500">{tutor.phone_number}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-medium">{tutor.city}, {tutor.province}</div>
                        <div className="text-xs text-gray-500">{tutor.teachingMode}</div>
                      </td>
                      <td className="py-4 px-4">
                        {tutor.introVideo ? (
                          <span className="inline-block px-2.5 py-1 bg-green-50 text-green-700 font-bold text-xs rounded-md border border-green-200">
                            🎥 Submitted
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-1 bg-gray-100 text-gray-500 font-medium text-xs rounded-md">
                            ○ Pending Upload
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-full uppercase ${
                          tutor.profileCompletionStatus === "verified" 
                            ? "bg-green-100 text-green-800" 
                            : tutor.profileCompletionStatus === "pending_verification"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}>
                          {tutor.profileCompletionStatus || "incomplete"}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right space-x-2">
                        <button
                          onClick={() => setSelectedTutor(tutor)}
                          className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded-md text-xs font-bold hover:bg-gray-200 transition-colors"
                        >
                          Review & Verify
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

      {/* Tutor Review & Verification Modal */}
      {selectedTutor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6">
            <div className="flex justify-between items-start border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">{selectedTutor.fullName}</h2>
                <p className="text-xs text-gray-500">Tutor Audit & Profile Verification Portal</p>
              </div>
              <button 
                onClick={() => setSelectedTutor(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Email Address</span>
                  <span className="font-medium text-gray-800">{selectedTutor.email}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Phone Number</span>
                  <span className="font-medium text-gray-800">{selectedTutor.phone_number}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">WhatsApp Contact</span>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="font-bold text-gray-900">{selectedTutor.whatsapp || selectedTutor.phone_number}</span>
                    <a
                      href={`https://wa.me/${(selectedTutor.whatsapp || selectedTutor.phone_number).replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-0.5 bg-green-500 hover:bg-green-600 text-white font-bold text-xs rounded shadow-xs"
                    >
                      💬 Chat
                    </a>
                  </div>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Profile Status</span>
                  <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded-full uppercase mt-1 ${
                    selectedTutor.profileCompletionStatus === "verified" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                  }`}>
                    {selectedTutor.profileCompletionStatus}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">City & Province</span>
                  <span className="font-medium text-gray-800">{selectedTutor.city}, {selectedTutor.province}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Connects Balance</span>
                  <span className="font-bold text-blue-600">⚡ {selectedTutor.connectsBalance} Connects</span>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Education & Degrees Claimed</h3>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 font-medium text-gray-800">
                  {Array.isArray(selectedTutor.degrees) ? selectedTutor.degrees.join(", ") : selectedTutor.degrees}
                </div>
              </div>

              {/* YouTube Video & Degree Showcase Review */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">60s YouTube Intro & Degree Verification Video</h3>
                {selectedTutor.introVideo ? (
                  <div className="p-4 bg-gray-900 text-white rounded-xl space-y-3">
                    <p className="text-xs text-gray-300">
                      Watch the video below to verify the tutor's introduction and confirm they physically showed their valid degree certificates on camera:
                    </p>
                    <a 
                      href={selectedTutor.introVideo} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-block px-4 py-2 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-lg transition-colors"
                    >
                      ▶ Watch YouTube Verification Video
                    </a>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-bold rounded-xl">
                    ⚠️ Tutor has not uploaded their 60-second verification video yet.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
              <button
                onClick={() => setSelectedTutor(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-colors"
              >
                Close
              </button>

              <div className="space-x-2">
                {selectedTutor.profileCompletionStatus !== "verified" ? (
                  <button
                    onClick={() => handleProfileVerification(selectedTutor._id, "verified")}
                    disabled={actionLoading === selectedTutor._id || !selectedTutor.introVideo}
                    className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl transition-colors shadow-sm disabled:opacity-50"
                  >
                    {actionLoading === selectedTutor._id ? "Processing..." : "Verify Profile (100% Complete)"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleProfileVerification(selectedTutor._id, "pending_verification")}
                    disabled={actionLoading === selectedTutor._id}
                    className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-xl transition-colors shadow-sm disabled:opacity-50"
                  >
                    {actionLoading === selectedTutor._id ? "Processing..." : "Revoke Verification"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}