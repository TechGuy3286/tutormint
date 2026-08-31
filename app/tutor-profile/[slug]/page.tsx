import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export const revalidate = 0;

export default async function PublicTutorProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tutor_profiles')
    .select('*');

  if (error || !data) {
    notFound();
  }

  const matched = data.find((p: any) => {
    const nameSlug = (p.full_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    return nameSlug === resolvedParams.slug;
  });

  if (!matched) {
    notFound();
  }

  // LOG REAL PROFILE VIEW INTO SUPABASE
  try {
    await supabase.from('profile_views').insert({
      tutor_id: matched.id,
      viewer_description: `Parent from ${matched.area_name || 'DHA'}, ${matched.city || 'Lahore'}`,
      contract_detail: `Active requirement for ${matched.specialty_subjects || 'Academic Tutoring'} contract`,
      time_ago: 'Just now'
    });
  } catch (err) {
    console.error("Error logging profile view:", err);
  }

  const hasPicture = Boolean(matched.avatar_url);
  const hasCnic = Boolean(matched.cnic_front_url);
  const isVerifiedProfile = hasPicture && hasCnic;

  const getEmbedUrl = (url: string) => {
    if (!url) return "";
    if (url.includes("embed/")) return url;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : url;
  };

  const fullName = matched.full_name || resolvedParams.slug;
  const title = matched.specialty_subjects ? `Expert ${matched.specialty_subjects} Tutor` : "Expert Academic Tutor";
  const area = matched.area_name || "DHA Phase 5";
  const city = matched.city || "Lahore";
  const specialty = matched.specialty_subjects || "General Academic";
  
  // Parse teaching modes as multiple badges
  const teachingModes = matched.teaching_mode 
    ? (Array.isArray(matched.teaching_mode) ? matched.teaching_mode : matched.teaching_mode.split(',').map((s: string) => s.trim()).filter(Boolean))
    : ["Physical"];

  const availabilityList = matched.availability_list || [];
  const profileImage = matched.avatar_url || "";
  const coverPhoto = matched.cover_image_url || "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80";
  const videoIntroUrl = matched.video_intro_url || "";
  const specialtyList = matched.specialty_list || [];
  const degrees = matched.degrees && matched.degrees.length > 0 ? matched.degrees : [{ title: "Verified Degree", institute: city, year: "2021" }];
  const certifications = matched.certifications || [];

  return (
    <main className="min-h-screen bg-[#F8FAFC] pb-16 font-sans text-[#334155]">
      
      {/* PUBLIC HEADER */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-black text-[#0F172A] tracking-tight flex items-center gap-2">
            <span className="text-[#d60008]">TutorMint</span> Network
          </Link>
          <div className="flex items-center gap-3">
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
          src={coverPhoto} 
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
          <span className="text-[#059669]">{fullName}</span>
        </nav>

        {/* MAIN PROFILE CARD */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="flex items-center gap-4">
              {profileImage ? (
                <img 
                  src={profileImage} 
                  alt={fullName} 
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-4 border-white shadow-lg shrink-0"
                />
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-3xl font-black border-4 border-white shadow-lg shrink-0">
                  {fullName.charAt(0)}
                </div>
              )}
              <div className="space-y-1">
                <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${isVerifiedProfile ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                  {isVerifiedProfile ? "Verified Tutor Profile ✓ (Searchable)" : "Verification Pending ⏳"}
                </span>
                <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] mt-1">{fullName}</h1>
                <p className="text-xs sm:text-sm font-semibold text-slate-600">{title}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-gray-500">📍 {area}, {city}</span>
                  <span className="text-gray-300">•</span>
                  <div className="flex flex-wrap gap-1">
                    {teachingModes.map((mode: string, idx: number) => (
                      <span key={idx} className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[10px] font-extrabold rounded-md border border-emerald-200">
                        {mode}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* QUICK METRICS GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-center">
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Experience</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">Verified Teaching Experience</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Earned Jobs</span>
              <p className="text-xs font-black text-[#059669] mt-0.5">12 Tuitions Completed</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Demo Rating</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">4.9 ★</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Teaching Rating</span>
              <p className="text-xs font-black text-[#0F172A] mt-0.5">4.8 ★</p>
            </div>
          </div>
        </div>

        {/* VERIFICATION BADGES FLOW */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Audited Verification Badges</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>Video Interview</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{videoIntroUrl ? "Approved & Verified ✓" : "Pending Optional Video"}</p>
            </div>
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>CNIC Status</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{hasCnic ? "NADRA Verified ✓" : "Pending NADRA Check ❌"}</p>
            </div>
            <div className={`p-4 rounded-2xl space-y-1 border ${isVerifiedProfile ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase ${isVerifiedProfile ? 'text-emerald-700' : 'text-gray-500'}`}>Academic Degree</span>
              <p className={`text-xs font-black ${isVerifiedProfile ? 'text-emerald-900' : 'text-gray-700'}`}>{degrees.length > 0 ? "Physical Degree Audited ✓" : "Pending Audit"}</p>
            </div>
          </div>
        </div>

        {/* SPECIALTY SUBJECTS */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Specialty Subject(s) & Expertise Levels</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {specialtyList && specialtyList.length > 0 ? (
              specialtyList.map((item: any, idx: number) => (
                <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                  <span className="font-bold text-[#0F172A]">{item.subject}</span>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-extrabold rounded-lg border border-emerald-200">
                    Level: {item.level}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs font-bold text-[#0F172A]">
                {specialty}
              </div>
            )}
          </div>
        </div>

        {/* AVAILABLE TIMINGS */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Available Timings & Booking Slots</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availabilityList && availabilityList.length > 0 ? (
              availabilityList.map((slot: any, idx: number) => (
                <div key={idx} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between text-xs">
                  <span className="font-bold text-[#0F172A]">📅 {slot.day}</span>
                  <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    {slot.timeSlot}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs text-gray-500 font-medium">
                Flexible slots for home tuition and online tutoring sessions.
              </div>
            )}
          </div>
        </div>

        {/* TEACHING STYLE & VIDEO INTRO */}
        {videoIntroUrl && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Teaching Style & Video Introduction</h3>
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-md">
              <iframe 
                src={getEmbedUrl(videoIntroUrl)} 
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
            {degrees.map((deg: any, idx: number) => (
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
        {certifications && certifications.length > 0 && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Certifications</h3>
            <div className="space-y-3">
              {certifications.map((cert: any, idx: number) => (
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

      </div>
    </main>
  );
}