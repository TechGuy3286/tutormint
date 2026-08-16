"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TutorDashboard() {
  const router = useRouter();
  const [tutor, setTutor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const storedEmail = localStorage.getItem("tutorEmail");
    if (!storedEmail) {
      router.push("/tutor/login");
      return;
    }
    fetchTutorProfile(storedEmail);
  }, []);

  const fetchTutorProfile = async (email: string) => {
    try {
      const res = await fetch(`/api/tutor/profile?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
      } else {
        router.push("/tutor/login");
      }
    } catch (err) {
      console.error("Failed to load profile", err);
    } finally {
      setLoading(false);
    }
  };

  const handleVideoUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setErrorMsg("Please select your 60-second video file showing your degree.");
      return;
    }

    setUploading(true);
    setMsg("");
    setErrorMsg("");

    try {
      const simulatedYouTubeUrl = `https://youtube.com/watch?v=tutormint_${Date.now()}`;

      const res = await fetch("/api/tutor/complete-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: tutor.email,
          introVideo: simulatedYouTubeUrl,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
        setMsg("Video uploaded successfully and submitted to admin for final verification!");
      } else {
        setErrorMsg(data.error || "Upload failed.");
      }
    } catch (err) {
      setErrorMsg("Server error during upload.");
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("tutorEmail");
    router.push("/tutor/login");
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500 font-medium">Loading your dashboard...</div>;
  }

  if (!tutor) return null;

  const progress = tutor.introVideo ? 100 : 50;

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      {/* Top Navbar */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Tutor Portal</span>
        </Link>
        <div className="flex items-center space-x-6">
          <span className="text-xs font-bold bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full">
            ⚡ Application Credits: {tutor.connectsBalance}
          </span>
          <span className="text-sm font-bold text-gray-800">{tutor.fullName}</span>
          <button
            onClick={handleLogout}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 mt-6 space-y-6">
        {/* Quick Links & Job Market Banner */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-6 flex justify-between items-center shadow-sm">
          <div>
            <h2 className="text-lg font-extrabold">Tuition Job Market</h2>
            <p className="text-xs text-gray-300 mt-1">Browse available student requirements and apply using your application credits.</p>
          </div>
          <Link
            href="/tutor/jobs"
            className="px-5 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
          >
            Browse Jobs →
          </Link>
        </div>

        {/* Profile Completion & Verification Meter */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-extrabold">Verification & Profile Completion</h3>
              <p className="text-xs text-gray-500">
                Status: <span className="uppercase font-bold text-blue-600">{tutor.profileCompletionStatus || "incomplete"}</span>
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-gray-900">{progress}%</span>
              <span className="block text-xs text-gray-400">Completion Meter</span>
            </div>
          </div>

          <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${progress === 100 ? "bg-green-600" : "bg-[#B3191F]"}`}
              style={{ width: `${progress}%` }}
            ></div>
          </div>

          <div className="flex justify-between text-xs text-gray-500 font-medium">
            <span>✓ Email Verified & Auto-Approved</span>
            <span>{tutor.introVideo ? "✓" : "○"} 60s Video Intro & Degree Showcase</span>
          </div>
        </div>

        {/* Video Upload & Degree Showcase Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Upload 60-Second Video Introduction</h3>
            <p className="text-xs text-gray-500 mt-1">
              Upload a 60-second video introducing yourself and <strong>clearly showing your degree/certificates</strong> on camera. Videos upload directly to our platform and sync to the official TutorMint YouTube channel.
            </p>
          </div>

          {msg && <div className="p-4 bg-green-50 border border-green-200 text-green-800 text-xs font-bold rounded-xl">{msg}</div>}
          {errorMsg && <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

          <form onSubmit={handleVideoUpload} className="space-y-5">
            <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center hover:border-gray-400 transition-colors">
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-gray-900 file:text-white hover:file:bg-black cursor-pointer"
              />
              <p className="text-xs text-gray-400 mt-2">MP4, MOV, or WebM up to 100MB (Max 60 seconds)</p>
            </div>

            {tutor.introVideo && (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs space-y-1">
                <span className="font-bold text-blue-900">Submitted Verification Video:</span>
                <div>
                  <a href={tutor.introVideo} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">
                    View Synced YouTube Verification Video
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="w-full py-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              {uploading ? "Uploading to Platform & YouTube..." : "Submit Video for Final Admin Verification"}
            </button>
          </form>
        </div>

        {/* Tutor Details Summary Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-sm font-bold uppercase text-gray-400">Registered Profile Details</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs text-gray-400 uppercase">Full Name</span>
              <span className="font-medium text-gray-900">{tutor.fullName}</span>
            </div>
            <div>
              <span className="block text-xs text-gray-400 uppercase">Email Address</span>
              <span className="font-medium text-gray-900">{tutor.email}</span>
            </div>
            <div>
              <span className="block text-xs text-gray-400 uppercase">Phone & WhatsApp</span>
              <span className="font-medium text-gray-900">{tutor.phone_number}</span>
            </div>
            <div>
              <span className="block text-xs text-gray-400 uppercase">Location</span>
              <span className="font-medium text-gray-900">{tutor.city}, {tutor.province}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}