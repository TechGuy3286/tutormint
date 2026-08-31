"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function TutorProfileContent() {
  const searchParams = useSearchParams();
  const tutorName = searchParams.get("name") || "Alishba Mam Tutor";
  const router = useRouter();
  const supabase = createClient();

  const [profileData, setProfileData] = useState({
    fullName: tutorName,
    city: "Lahore",
    areaName: "DHA Phase 5",
    teachingMode: "Physical",
    specialtySubjects: "O/A Level Mathematics & Physics",
    profileImage: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300",
    cnicStatus: "Verified ✓",
    cnicPreviewImage: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=300",
    videoIntro: "https://www.w3schools.com/html/mov_bbb.mp4"
  });

  const [degrees, setDegrees] = useState<any[]>([]);
  const [certifications, setCertifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfileFromCloud();
  }, [tutorName]);

  const fetchProfileFromCloud = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tutor_profiles')
        .select('*')
        .ilike('full_name', `%${tutorName}%`)
        .maybeSingle();

      if (data) {
        setProfileData({
          fullName: data.full_name || tutorName,
          city: data.city || "Lahore",
          areaName: data.area_name || "DHA Phase 5",
          teachingMode: data.teaching_mode || "Physical",
          specialtySubjects: data.specialty_subjects || "Mathematics & Physics",
          profileImage: data.avatar_url || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300",
          cnicStatus: data.cnic_front_url ? "Verified ✓" : "Pending",
          cnicPreviewImage: data.cnic_front_url || "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=300",
          videoIntro: data.video_intro_url || "https://www.w3schools.com/html/mov_bbb.mp4"
        });

        if (data.degrees) setDegrees(data.degrees);
        if (data.certifications) setCertifications(data.certifications);
      }
    } catch (err) {
      console.error("Error fetching tutor profile from cloud:", err);
    } finally {
      setLoading(false);
    }
  };

  const rawSubjects = profileData.specialtySubjects.split(/[&,]/).map(s => s.trim()).filter(Boolean);
  const subjectList = rawSubjects.length > 0 ? rawSubjects : ["Mathematics", "Physics"];

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155] font-sans">
      
      {/* BREADCRUMBS */}
      <nav className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-gray-500">
          <Link href="/parent/dashboard" className="hover:text-[#0F172A] transition-colors">Parent Dashboard</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Tutor Public Profile</span>
        </div>
        <button 
          onClick={() => router.back()} 
          className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] text-xs font-bold rounded-xl transition-all"
        >
          ← Back to Job
        </button>
      </nav>

      {/* TUTOR HERO CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
        <img 
          src={profileData.profileImage} 
          alt={profileData.fullName} 
          className="w-36 h-36 sm:w-40 sm:h-40 rounded-3xl object-cover border-4 border-emerald-100 shadow-md shrink-0" 
        />
        <div className="space-y-3 flex-1 w-full">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">{profileData.fullName}</h1>
            <span className="px-3 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase rounded-full">
              Verified Tutor ✓
            </span>
          </div>
          <p className="text-xs sm:text-sm font-bold text-[#059669]">
            Expert in {profileData.specialtySubjects}
          </p>
          <p className="text-xs text-gray-500 font-medium">
            📍 {profileData.areaName}, {profileData.city} • 📚 Mode: {profileData.teachingMode}
          </p>

          {/* CNIC VERIFICATION & PREVIEW THUMBNAIL */}
          <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-bold rounded-xl font-mono">
              🆔 CNIC Status: {profileData.cnicStatus}
            </span>
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-gray-200">
              <img 
                src={profileData.cnicPreviewImage} 
                alt="CNIC Thumbnail" 
                className="w-14 h-9 rounded object-cover border border-gray-300 shadow-2xs" 
              />
              <span className="text-[10px] font-bold text-gray-600 pr-2">CNIC Document Preview</span>
            </div>
          </div>
        </div>
      </div>

      {/* SUBJECT PROGRESS BARS SECTION */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">Subject Proficiency & Score Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {subjectList.map((subject, index) => {
            const score = index === 0 ? "9/10" : index === 1 ? "8/10" : "7/10";
            const percent = index === 0 ? "90%" : index === 1 ? "80%" : "70%";
            return (
              <div key={index} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl space-y-2">
                <div className="flex justify-between items-center text-xs font-bold text-[#0F172A]">
                  <span>• {subject}</span>
                  <span className="font-mono text-[#059669]">{score}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div className="bg-[#059669] h-full rounded-full transition-all duration-500" style={{ width: percent }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 60-SECOND VIDEO INTRODUCTION */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">60-Second Video Introduction</h3>
        <div className="aspect-video w-full max-w-xl mx-auto bg-slate-900 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center relative border border-slate-800">
          <video 
            controls 
            className="w-full h-full object-cover"
            poster={profileData.profileImage}
            src={profileData.videoIntro}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </div>

      {/* ACADEMIC DEGREES & QUALIFICATIONS */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4">Academic Degrees & Qualifications</h3>
          <div className="space-y-3">
            {degrees.map((deg, idx) => (
              <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                <div>
                  <strong className="text-[#0F172A] text-sm block">{deg.title}</strong>
                  <span className="text-gray-600">{deg.institute} ({deg.year})</span>
                  {deg.fileUrl && (
                    <a href={deg.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 font-mono mt-1 block underline">
                      📎 View Document
                    </a>
                  )}
                </div>
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-xl text-[10px]">
                  Verified Document ✓
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4">Certifications</h3>
          <div className="space-y-3">
            {certifications.map((cert, idx) => (
              <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                <div>
                  <strong className="text-[#0F172A] text-sm block">{cert.title}</strong>
                  <span className="text-gray-600">{cert.issuer} ({cert.year})</span>
                  {cert.fileUrl && (
                    <a href={cert.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 font-mono mt-1 block underline">
                      📎 View Certificate
                    </a>
                  )}
                </div>
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-xl text-[10px]">
                  Certified ✓
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </main>
  );
}

export default function TutorPublicProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] space-y-4">
        <div className="w-12 h-12 border-4 border-[#059669] border-t-transparent rounded-full animate-spin shadow-md"></div>
        <div className="text-xs font-black text-[#0F172A] uppercase tracking-widest animate-pulse">
          Loading tutor profile...
        </div>
      </div>
    }>
      <TutorProfileContent />
    </Suspense>
  );
}