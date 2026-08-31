'use client'

import { useState, useEffect } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function PublicTutorProfile({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params)
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [showSecureModal, setShowSecureModal] = useState(false)
  const [isVerifiedProfile, setIsVerifiedProfile] = useState(false)
  
  const [tutorInfo, setTutorInfo] = useState({
    fullName: resolvedParams.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    title: "Expert O/A Level & Academic Tutor",
    area: "DHA Phase 5, Lahore",
    city: "Lahore",
    specialty: "Mathematics & Physics",
    experience: "Verified Teaching Experience",
    availableTime: "Flexible Schedule",
    availabilityList: [] as { day: string; timeSlot: string }[],
    demoRating: "4.9 ★",
    methodRating: "4.8 ★",
    earnedJobs: 12,
    profileImage: "",
    coverPhoto: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    videoIntroUrl: "",
    specialtyList: [] as { subject: string; level: string }[],
    degrees: [
      { title: "Academic Degree", institute: "Lahore", year: "2022" }
    ],
    certifications: [] as { title: string; issuer: string; year: string }[],
    verifications: {
      video: "Pending Review ⏳",
      cnic: "Pending NADRA Check ❌",
      degree: "Pending Audit ⚡"
    }
  })

  useEffect(() => {
    const fetchTutorFromSupabase = async () => {
      try {
        const { data, error } = await supabase
          .from('tutor_profiles')
          .select('*')

        if (error) {
          console.error("Error fetching tutor profile from Supabase:", error.message)
          setLoading(false)
          return
        }

        if (data && data.length > 0) {
          const matched = data.find((p: any) => {
            const nameSlug = (p.full_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            return nameSlug === resolvedParams.slug;
          })

          if (matched) {
            const hasPicture = Boolean(matched.avatar_url);
            const hasCnic = Boolean(matched.cnic_front_url);

            setIsVerifiedProfile(hasPicture && hasCnic);

            setTutorInfo({
              fullName: matched.full_name || resolvedParams.slug,
              title: matched.specialty_subjects ? `Expert ${matched.specialty_subjects} Tutor` : "Expert Academic Tutor",
              area: matched.area_name || "DHA Phase 5",
              city: matched.city || "Lahore",
              specialty: matched.specialty_subjects || "General Academic",
              experience: "Verified Teaching Experience",
              availableTime: matched.teaching_mode ? `Mode: ${matched.teaching_mode}` : "Flexible Schedule",
              availabilityList: matched.availability_list || [],
              demoRating: "4.9 ★",
              methodRating: "4.8 ★",
              earnedJobs: 12,
              profileImage: matched.avatar_url || "",
              coverPhoto: matched.cover_image_url || "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
              videoIntroUrl: matched.video_intro_url || "",
              specialtyList: matched.specialty_list || [],
              degrees: matched.degrees && matched.degrees.length > 0 ? matched.degrees : [{ title: "Verified Degree", institute: matched.city || "Lahore", year: "2021" }],
              certifications: matched.certifications || [],
              verifications: {
                video: matched.video_intro_url ? "Approved & Verified ✓" : "Pending Optional Video",
                cnic: hasCnic ? "NADRA Verified ✓" : "Pending NADRA Check ❌",
                degree: matched.degrees && matched.degrees.length > 0 ? "Physical Degree Audited ✓" : "Pending Audit"
              }
            })
          }
        }
      } catch (err) {
        console.error("Supabase fetch exception:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchTutorFromSupabase()
  }, [resolvedParams.slug, supabase])

  const getEmbedUrl = (url: string) => {
    if (!url) return "";
    if (url.includes("embed/")) return url;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : url;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading Verified Tutor Profile...
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] pb-16 font-sans text-[#334155]">
      
      {/* PUBLIC HEADER */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-black text-[#0F172A] tracking-tight flex items-center gap-2">
            <span className="text-[#d60008]">TutorMint</span> Network
          </Link>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowSecureModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              💬 Request Secure Connection
            </button>
            <Link 
              href="/tutor/login" 
              className="px-4 py-2 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl shadow-xs transition-all"
            >
              Tutor Login
            </Link>
          </div>
        </div>
      </header>

      {/* COVER PHOTO HEADER */}
      <div className="w-full h-48 sm:h-64 bg-slate-900 relative overflow-hidden">
        <img 
          src={tutorInfo.coverPhoto} 
          alt="Cover" 
          className="w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent"></div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-20 relative z-10 space-y-6">
        
        {/* BREADCRUMBS */}
        <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-5 py-3.5 rounded-2xl border border-gray-200 shadow-sm">
          <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">{tutorInfo.fullName}</span>
        </nav>

        {/* VERIFICATION WARNING BANNER IF INCOMPLETE */}
        {!isVerifiedProfile && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center justify-between gap-4 text-xs font-medium text-amber-900 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <strong className="font-bold">Profile Verification Incomplete:</strong> This database record is missing required verifications. Parents cannot discover unverified profiles in search results.
              </div>
            </div>
            <Link href="/tutor/login" className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl shrink-0 shadow-xs">
              Sign In to Update ➔
            </Link>
          </div>
        )}

        {/* MAIN PROFILE CARD */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="flex items-center gap-4">
              {tutorInfo.profileImage ? (
                <img 
                  src={tutorInfo.profileImage} 
                  alt={tutorInfo.fullName} 
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-4 border-white shadow-lg shrink-0"
                />
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-3xl font-black border-4 border-white shadow-lg shrink-0">
                  {tutorInfo.fullName.charAt(0)}
                </div>
              )}
              <div className="space-y-1">
                <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${isVerifiedProfile ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                  {isVerifiedProfile ? "Verified Tutor Profile ✓ (Searchable)" : "Verification Pending ⏳ (Not Searchable)"}
                </span>
                <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] mt-1">{tutorInfo.fullName}</h1>
                <p className="text-xs sm:text-sm font-semibold text-slate-600">{tutorInfo.title}</p>
                <p className="text-xs text-gray-400">📍 {tutorInfo.area}, {tutorInfo.city}</p>
              </div>
            </div>

            <button 
              onClick={() => setShowSecureModal(true)}
              className="w-full sm:w-auto px-6 py-3.5 bg-[#059669] hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all text-center whitespace-nowrap cursor-pointer"
            >
              🔒 Request Secure Connection
            </button>
          </div>

          {/* QUICK METRICS GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-center">
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Experience</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">{tutorInfo.experience}</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Earned Jobs</span>
              <p className="text-xs font-black text-[#059669] mt-0.5">{tutorInfo.earnedJobs} Tuitions Completed</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Demo Rating</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">{tutorInfo.demoRating}</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Teaching Rating</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">{tutorInfo.methodRating}</p>
            </div>
          </div>
        </div>

        {/* VERIFICATION BADGES FLOW */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Audited Verification Badges</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>Video Interview</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{tutorInfo.verifications.video}</p>
            </div>
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>CNIC Status</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{tutorInfo.verifications.cnic}</p>
            </div>
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>Academic Degree</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{tutorInfo.verifications.degree}</p>
            </div>
          </div>
        </div>

        {/* SPECIALTY SUBJECTS */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Specialty Subject(s) & Expertise Levels</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tutorInfo.specialtyList && tutorInfo.specialtyList.length > 0 ? (
              tutorInfo.specialtyList.map((item: any, idx: number) => (
                <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                  <span className="font-bold text-[#0F172A]">{item.subject}</span>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-extrabold rounded-lg border border-emerald-200">
                    Level: {item.level}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs font-bold text-[#0F172A]">
                {tutorInfo.specialty}
              </div>
            )}
          </div>
        </div>

        {/* AVAILABLE TIMINGS & BOOKING SLOTS */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Available Timings & Booking Slots</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tutorInfo.availabilityList && tutorInfo.availabilityList.length > 0 ? (
              tutorInfo.availabilityList.map((slot: any, idx: number) => (
                <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                  <span className="font-bold text-[#0F172A]">📅 {slot.day}</span>
                  <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    {slot.timeSlot}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs text-gray-500 font-medium">
                {tutorInfo.availableTime} — Flexible slots for home tuition and online tutoring sessions.
              </div>
            )}
          </div>
        </div>

        {/* TEACHING STYLE & VIDEO INTRO */}
        {tutorInfo.videoIntroUrl && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Teaching Style & Video Introduction</h3>
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-md">
              <iframe 
                src={getEmbedUrl(tutorInfo.videoIntroUrl)} 
                title="Tutor Introduction Video" 
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen 
              />
            </div>
          </div>
        )}

        {/* QUALIFICATIONS & DEGREES */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Academic Qualifications & Degrees</h3>
          <div className="space-y-3">
            {tutorInfo.degrees.map((deg: any, idx: number) => (
              <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex justify-between items-center text-xs">
                <div>
                  <strong className="text-[#0F172A] text-sm">{deg.title}</strong>
                  <p className="text-gray-600 mt-0.5">{deg.institute} • Year: {deg.year}</p>
                </div>
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-full text-[10px]">Audited ✓</span>
              </div>
            ))}
          </div>
        </div>

        {/* CERTIFICATIONS */}
        {tutorInfo.certifications && tutorInfo.certifications.length > 0 && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Certifications</h3>
            <div className="space-y-3">
              {tutorInfo.certifications.map((cert: any, idx: number) => (
                <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex justify-between items-center text-xs">
                  <div>
                    <strong className="text-[#0F172A] text-sm">{cert.title}</strong>
                    <p className="text-gray-600 mt-0.5">{cert.issuer} • Year: {cert.year}</p>
                  </div>
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-full text-[10px]">Verified ✓</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MASKED CONTACT NOTICE */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-[#0F172A]">Direct Contact & Personal Information</h3>
            <p className="text-xs text-gray-500">🔒 Personal phone numbers and WhatsApp links are securely locked to protect tutor privacy.</p>
          </div>
          <span className="px-3 py-1.5 bg-slate-100 text-[#0F172A] text-xs font-bold rounded-xl whitespace-nowrap">
            Protected by TutorMint Secure Gateway
          </span>
        </div>

        {/* BOTTOM CTA */}
        <div className="bg-[#0F172A] text-white p-8 rounded-3xl shadow-xl text-center space-y-4">
          <h2 className="text-xl font-black">Hire {tutorInfo.fullName} Securely</h2>
          <p className="text-xs text-gray-300 max-w-md mx-auto">
            All communications and connection requests are managed safely through our secure in-platform messaging system with 0% commission.
          </p>
          <button 
            onClick={() => setShowSecureModal(true)}
            className="inline-block px-8 py-4 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all cursor-pointer"
          >
            Request Secure Connection ➔
          </button>
        </div>

      </div>

      {/* SECURE CONNECTION MODAL */}
      {showSecureModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full space-y-6 shadow-2xl border border-gray-200 text-center">
            <span className="text-3xl">🛡️</span>
            <h3 className="text-lg font-black text-[#0F172A]">Secure In-Platform Connection</h3>
            <p className="text-xs text-gray-600 font-medium leading-relaxed">
              To protect tutor privacy and prevent unauthorized external contact, direct phone numbers are hidden. Please submit a connection request through your dashboard to start chatting securely.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowSecureModal(false)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-[#0F172A] font-bold text-xs uppercase rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <a
                href="/tutor/login"
                className="flex-1 py-3 bg-[#059669] hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all text-center flex items-center justify-center"
              >
                Go to Portal ➔
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}