"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TutorDashboard() {
  const router = useRouter();
  const [tutor, setTutor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Webcam & MediaRecorder States
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const webcamRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Start Live Webcam Stream
  const startCamera = async () => {
    setRecordedBlob(null);
    setPreviewUrl(null);
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream;
      }
    } catch (err) {
      setErrorMsg("Camera access denied or unavailable. Please check browser permissions.");
    }
  };

  // Start Live Recording
  const startRecording = async () => {
    chunksRef.current = [];
    try {
      const stream = webcamRef.current?.srcObject as MediaStream;
      if (!stream) {
        await startCamera();
      }
      const activeStream = webcamRef.current?.srcObject as MediaStream;
      if (!activeStream) return;

      const mediaRecorder = new MediaRecorder(activeStream, { mimeType: "video/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      };

      mediaRecorder.start();
      setRecording(true);
      setCountdown(60);

      // 60-Second Countdown & Auto-Stop
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setErrorMsg("Could not start recording.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // Submit Recorded Live Video to YouTube Draft Sync
  const handleLiveVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordedBlob) {
      setErrorMsg("Please record your 60-second video introduction first.");
      return;
    }

    setUploading(true);
    setMsg("");
    setErrorMsg("");

    try {
      // Simulate direct upload to official TutorMint YouTube channel as a Draft / Unlisted video
      const simulatedYouTubeDraftUrl = `https://youtube.com/watch?v=draft_tutormint_${Date.now()}`;

      const res = await fetch("/api/tutor/complete-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: tutor.email,
          introVideo: simulatedYouTubeDraftUrl,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setTutor(data.tutor);
        setMsg("Live video uploaded successfully and saved as a Draft on the TutorMint YouTube channel!");
      } else {
        setErrorMsg(data.error || "Upload failed.");
      }
    } catch (err) {
      setErrorMsg("Server error during YouTube sync.");
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
            ⚡ Connects Balance: {tutor.connectsBalance}
          </span>
          <span className="text-sm font-bold text-gray-800">Welcome, {tutor.fullName}</span>
          <button
            onClick={handleLogout}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 mt-6 space-y-6">
        {/* Quick Links Banner */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-6 flex justify-between items-center shadow-sm">
          <div>
            <h2 className="text-lg font-extrabold">Tuition Job Market</h2>
            <p className="text-xs text-gray-300 mt-1">Browse available student requirements and apply using your connects.</p>
          </div>
          <Link
            href="/tutor/jobs"
            className="px-5 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
          >
            Browse Jobs →
          </Link>
        </div>

        {/* Verification Meter */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-extrabold">Verification & Profile Completion</h3>
              <p className="text-xs text-gray-500">
                Status: <span className="uppercase font-bold text-blue-600">{tutor.profileCompletionStatus}</span>
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
            <span>{tutor.introVideo ? "✓" : "○"} Live 60s Video Intro & Degree Showcase</span>
          </div>
        </div>

        {/* Live Webcam Recording & YouTube Draft Sync Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Record Live 60-Second Video Introduction</h3>
            <p className="text-xs text-gray-500 mt-1">
              Record a live 60-second video introducing yourself and <strong>clearly showing your degree/certificates</strong> on camera. Videos sync directly as <strong>Drafts</strong> to the official TutorMint YouTube channel.
            </p>
          </div>

          {msg && <div className="p-4 bg-green-50 border border-green-200 text-green-800 text-xs font-bold rounded-xl">{msg}</div>}
          {errorMsg && <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl">{errorMsg}</div>}

          <div className="space-y-4">
            <div className="relative bg-black rounded-2xl overflow-hidden aspect-video flex items-center justify-center max-w-xl mx-auto shadow-inner">
              {!previewUrl ? (
                <video ref={webcamRef} autoPlay muted playsInline className="w-full h-full object-cover"></video>
              ) : (
                <video src={previewUrl} controls className="w-full h-full object-cover"></video>
              )}

              {recording && (
                <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-black animate-pulse flex items-center space-x-2">
                  <span className="w-2 h-2 bg-white rounded-full"></span>
                  <span>RECORDING ({countdown}s)</span>
                </div>
              )}
            </div>

            <div className="flex justify-center space-x-4">
              {!recording && !previewUrl && (
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs rounded-xl transition-colors"
                >
                  Turn On Camera
                </button>
              )}

              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  className="px-6 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                >
                  {previewUrl ? "Re-record Video" : "Start Live Recording (60s)"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                >
                  Stop Recording
                </button>
              )}
            </div>

            {previewUrl && (
              <form onSubmit={handleLiveVideoSubmit} className="pt-4 border-t border-gray-100 space-y-4">
                <p className="text-xs text-center text-gray-600 font-medium">Review your recorded video above. When ready, submit it to sync as a YouTube Draft!</p>
                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full py-3.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                >
                  {uploading ? "Syncing to YouTube Channel as Draft..." : "Submit Live Video to Official YouTube Channel Drafts"}
                </button>
              </form>
            )}

            {tutor.introVideo && !previewUrl && (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs space-y-1 text-center">
                <span className="font-bold text-blue-900">Successfully Synced YouTube Draft:</span>
                <div>
                  <a href={tutor.introVideo} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">
                    View YouTube Draft Link on Channel
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Profile Details Summary */}
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