"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Tutor {
  _id: string;
  fullName: string;
  email: string;
  phone_number: string;
  city: string;
  province: string;
  teachingMode: string;
  degrees: string[];
  status: string;
  createdAt: string;
}

export default function AdminDashboard() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
      } else {
        alert(data.error || "Failed to update status");
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Admin</span>
        </Link>
        <span className="text-sm font-semibold text-gray-600">Platform Management Portal</span>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto p-6 mt-6 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-[#EDEDED] p-6">
          <h1 className="text-2xl font-extrabold mb-1">Tutor Applications</h1>
          <p className="text-gray-500 text-sm mb-6">Review registered educators and approve them to make them visible on the parent catalog.</p>

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
                    <th className="py-3 px-4">Degrees</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {tutors.map((tutor) => (
                    <tr key={tutor._id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-4">
                        <div className="font-bold text-gray-900">{tutor.fullName}</div>
                        <div className="text-xs text-gray-500">{tutor.email}</div>
                        <div className="text-xs text-gray-500">{tutor.phone_number}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-medium">{tutor.city}, {tutor.province}</div>
                        <div className="text-xs text-gray-500">{tutor.teachingMode}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-xs font-medium text-gray-700">
                          {Array.isArray(tutor.degrees) ? tutor.degrees.join(", ") : tutor.degrees}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-full uppercase ${
                          tutor.status === "approved" 
                            ? "bg-green-100 text-green-800" 
                            : "bg-yellow-100 text-yellow-800"
                        }`}>
                          {tutor.status || "pending"}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right space-x-2">
                        {tutor.status !== "approved" ? (
                          <button
                            onClick={() => handleStatusChange(tutor._id, "approved")}
                            disabled={actionLoading === tutor._id}
                            className="px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === tutor._id ? "Processing..." : "Approve"}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(tutor._id, "pending")}
                            disabled={actionLoading === tutor._id}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md text-xs font-bold hover:bg-gray-300 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === tutor._id ? "Processing..." : "Revoke"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}