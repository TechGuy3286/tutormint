"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import ProfileCompletionWidget from "@/components/ProfileCompletionWidget";

// Mock data for tutors
const allTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    city: "Lahore",
    area: "Gulberg",
    subject: "Mathematics",
    grade: "10th Class",
    rating: 4.9,
    reviewCount: 24,
    degree: "BS Mathematics (LUMS)",
    mode: "Physical",
    budget: "25,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
  },
  {
    id: 2,
    name: "Muhammad Ali",
    city: "Lahore",
    area: "DHA",
    subject: "Physics",
    grade: "FSc Part 2",
    rating: 4.8,
    reviewCount: 19,
    degree: "BS Computer Science (PU)",
    mode: "Physical",
    budget: "30,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150"
  },
  {
    id: 3,
    name: "Alee Sabeer",
    city: "Karachi",
    area: "Clifton",
    subject: "Computer Science",
    grade: "O-Levels",
    rating: 5.0,
    reviewCount: 32,
    degree: "BS Software Engineering",
    mode: "Online / Physical",
    budget: "35,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
  }
];

const cityAreasMap: Record<string, string[]> = {
  Lahore: ["Gulberg", "DHA", "Johar Town", "Model Town", "Bahria Town"],
  Karachi: ["Clifton", "DHA", "Gulshan-e-Iqbal", "North Nazimabad"],
  Islamabad: ["F-6", "F-7", "G-8", "Bahria Town"],
  Multan: ["Cantt", "Shah Rukn-e-Alam", "Bosan Road"]
};

const renderStars = (rating: number) => {
  if (rating >= 4.9) return "⭐⭐⭐⭐⭐";
  return "⭐⭐⭐⭐";
};

export default function ParentDashboardPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState("All");
  const [selectedArea, setSelectedArea] = useState("All");
  const [selectedSkill, setSelectedSkill] = useState("All");
  const [selectedGrade, setSelectedGrade] = useState("All");
  
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [parentProfile, setParentProfile] = useState<any>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch posted jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('parent_id', user.id)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;
      setMyJobs(jobsData || []);

      // Fetch parent profile data for checklist
      const { data: profileData } = await supabase
        .from('parent_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setParentProfile(profileData || {
        full_name: user.email?.split('@')[0] || 'Parent',
        city: 'Lahore',
        area: 'Gulberg',
        student_grade: 'Matriculation'
      });

    } catch (err: any) {
      console.error("Error fetching dashboard data:", err.message);
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleProtectedAction = async (actionType: string, tutorData?: any) => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in or sign up to contact or hire tutors.");
      window.location.href = "/parent/login";
      return;
    }

    if (actionType === "hire") {
      window.open(`https://wa.me/923211045245?text=Hi%20I%20want%20to%20hire%20${encodeURIComponent(tutorData.name)}%20for%20${encodeURIComponent(tutorData.subject)}`, "_blank");
    } else if (actionType === "post-job") {
      router.push("/parent/dashboard/post-job");
    }
  };

  const filteredTutors = allTutors.filter((tutor) => {
    const matchSearch = searchQuery === "" || 
      tutor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tutor.area.toLowerCase().includes(searchQuery.toLowerCase());

    const matchCity = selectedCity === "All" || tutor.city === selectedCity;
    const matchArea = selectedArea === "All" || tutor.area === selectedArea;
    const matchSkill = selectedSkill === "All" || tutor.subject === selectedSkill;
    const matchGrade = selectedGrade === "All" || tutor.grade === selectedGrade;
    
    return matchSearch && matchCity && matchArea && matchSkill && matchGrade;
  });

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#000000] flex flex-col justify-between">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8 flex-1 w-full">
        
        {/* First-Month Trial & Fee Notice Banner */}
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-3xl flex items-center justify-between gap-4 shadow-xs">
          <div className="space-y-0.5">
            <h4 className="text-xs font-black text-blue-900 uppercase">🛡️ First Month Trial Active (Direct 2-Party Connection)</h4>
            <p className="text-[11px] text-blue-700">
              Your first month is considered a trial. Upon successful completion of the first month, a nominal service fee of 199 PKR applies.
            </p>
          </div>
          <span className="text-xl flex-shrink-0">✨</span>
        </div>

        {/* Header & Post Job CTA */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#000000]">
              Parent Dashboard
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Manage your posted requirements or browse verified tutors directly with zero middlemen.
            </p>
          </div>
          <button 
            onClick={() => handleProtectedAction("post-job")}
            className="px-5 py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span>📋 Post New Job Requirement</span>
          </button>
        </div>

        {/* Profile Completion & Checklist Widget */}
        <ProfileCompletionWidget userRole="parent" profileData={parentProfile} />

        {/* MY POSTED JOBS SECTION */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
              My Posted Jobs ({myJobs.length})
            </h2>
          </div>

          {loadingJobs ? (
            <div className="text-center py-6 text-xs text-gray-400">Loading your postings...</div>
          ) : myJobs.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-500 font-medium">You haven't posted any jobs yet.</p>
              <button 
                onClick={() => router.push("/parent/dashboard/post-job")}
                className="mt-3 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-emerald-600 transition-all"
              >
                Post Your First Job →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myJobs.map((job) => (
                <div key={job.job_tx_id || job.id} className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
                        {job.job_tx_id}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Status: {job.status || 'Active'}</span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900">{job.title}</h4>
                    <p className="text-xs text-gray-600">{job.subject} • {job.grade} • Budget: {job.budget}</p>
                  </div>

                  <button
                    onClick={() => router.push(`/chat/${job.job_tx_id}`)}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all whitespace-nowrap"
                  >
                    Open Chat & Tutors ➔
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* VERIFIED TUTORS FEED & SEARCH */}
        <div className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 px-2">
            Verified Tutors Feed ({filteredTutors.length})
          </h2>

          <div className="space-y-4">
            {filteredTutors.map((tutor) => (
              <div 
                key={tutor.id} 
                className="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
              >
                <div className="flex items-start gap-4 w-full sm:w-auto">
                  <img src={tutor.image} alt={tutor.name} className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
                  <div className="space-y-1.5 flex-1">
                    <h4 className="text-sm font-black text-[#000000]">{tutor.name}</h4>
                    <p className="text-xs font-bold text-[#1f1f7a]">Expert in {tutor.subject} ({tutor.grade})</p>
                    <p className="text-[11px] text-gray-600 font-medium">🎓 {tutor.degree} • 📍 {tutor.area}, {tutor.city}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleProtectedAction("hire", tutor)}
                  className="px-6 py-3 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-extrabold rounded-xl transition-all whitespace-nowrap"
                >
                  Hire / Contact ➔
                </button>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}