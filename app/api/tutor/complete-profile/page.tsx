"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function CompleteProfile() {
  const [tutorEmail, setTutorEmail] = useState("");
  const [tutor, setTutor] = useState<any>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleFetchProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/tutor/profile?email=${tutorEmail}`);
      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
      } else {
        setErrorMsg(data.error || "Tutor profile not found.");
      }
    } catch (err) {
      setErrorMsg("Failed to fetch profile.");
    } finally {
      setUploading(false);
    }
  };

  const handleVideoUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setErrorMsg("Please select or record your 60-second video introduction.");
      return;
    }

    setUploading(true);
    setErrorMsg("");

    try {
      // Simulate direct platform upload & YouTube channel sync
      // In production, this uploads to your server/S3 and triggers the YouTube API integration
      const simulatedYouTubeUrl = `https://youtube.com/watch?v=tutormint_${Date.now()}`;

      const res = await fetch("/api/tutor/complete-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: tutorEmail, 
          introVideo: simulatedYouTubeUrl,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
        setSuccessMsg("Video uploaded successfully and submitted for final admin verification!");
      } else {
        setErrorMsg(data.error || "Upload failed.");
      }
    } catch (err) {
      setErrorMsg("Server error during upload.");
    } finally {
      setUploading(false);
    }
  };

  // Calculate Progress Meter
  const calculateProgress = () => {
    if (!tutor) return 0;
    let score = 50; // Initial email verification & sign-up
    if (tutor.introVideo) score += 50; // 60s Video Intro with degrees shown = 100%
    return score;
  };

  const progress = calculateProgress();

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616]">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-xs">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Tutor<span className="text-[#B3191F]">Mint</span>
          <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-semibold">Tutor Portal</span>
        </Link>
        {tutor && (
          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
              ⚡ Connects Available: {tutor.connectsBalance}
            </span>
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto p-6 mt-8 space-y-6">
        {!tutor ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h1 className="text-2xl font-extrabold mb-2">Tutor Profile Verification & Video Intro</h1>
            <p className="text-gray-500 text-sm mb-6">Enter your registered email address to access your profile completion dashboard.</p>
            
            <form onSubmit={handleFetchProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Registered Email</label>
                <input
                  type="email"
                  required
                  value={tutorEmail}
                  onChange={(e) => setTutorEmail(e.target.value)}
                  placeholder="e.g. tutor@gmail.com"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black"
                />
              </div>
              {errorMsg && <p className="text-red-600 text-xs font-semibold">{errorMsg}</p>}
              <button
                type="submit"
                disabled={uploading}
                className="w-full py-3 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                {uploading ? "Loading..." : "Access Verification Portal"}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Progress Meter Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold">{tutor.fullName}</h2>
                  <p className="text-xs text-gray-500">Status: <span className="uppercase font-bold text-blue-600">{tutor.profileCompletionStatus}</span></p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-gray-900">{progress}%</span>
                  <span className="block text-xs text-gray-400">Completion Meter</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-600' : 'bg-[#B3191F]'}`} 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-xs text-gray-500 font-medium">
                <span>✓ Email Verified & Auto-Approved</span>
                <span>{tutor.introVideo ? '✓' : '○'} 60s Video Intro & Degree Showcase</span>
              </div>
            </div>

            {/* Video Upload Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Upload 60-Second Video Introduction</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Record a 60-second video introducing yourself and <strong>clearly showing your degree/certificates</strong> on camera. Videos are uploaded directly to our platform and synced to the official TutorMint YouTube channel for parent verification.
                </p>
              </div>
              
              {successMsg && (
                <div className="p-4 bg-green-50 border border-green-200 text-green-800 text-xs font-bold rounded-xl">
                  {successMsg}
                </div>
              )}
              {errorMsg && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleVideoUploadSubmit} className="space-y-5">
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
                    <span className="font-bold text-blue-900">Currently Uploaded Video:</span>
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
          </div>
        )}
      </main>
    </div>
  );
}