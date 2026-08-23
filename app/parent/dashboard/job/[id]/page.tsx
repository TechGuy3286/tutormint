"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const availableTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    subject: "Mathematics",
    grade: "10th Class",
    degree: "BS Mathematics (LUMS)",
    area: "Gulberg, Lahore",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
  },
  {
    id: 2,
    name: "Muhammad Ali",
    subject: "Physics",
    grade: "FSc Part 2",
    degree: "BS Computer Science (PU)",
    area: "DHA, Lahore",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150"
  },
  {
    id: 3,
    name: "Alee Sabeer",
    subject: "Computer Science",
    grade: "O-Levels",
    degree: "BS Software Engineering",
    area: "Clifton, Karachi",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
  }
];

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [shortlisted, setShortlisted] = useState<number[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [animatingOut, setAnimatingOut] = useState<number | null>(null);
  const [notificationMsg, setNotificationMsg] = useState("");

  useEffect(() => {
    fetchJobDetails();
    const savedShortlist = localStorage.getItem(`shortlist_${jobId}`);
    if (savedShortlist) {
      setShortlisted(JSON.parse(savedShortlist));
    }
    const savedRemoved = localStorage.getItem(`removed_${jobId}`);
    if (savedRemoved) {
      setRemoved(JSON.parse(savedRemoved));
    }
  }, [jobId]);

  const fetchJobDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('job_tx_id', jobId)
        .single();

      if (error) throw error;
      setJob(data);
    } catch (err) {
      console.error("Error loading job:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleShortlist = (tutorId: number) => {
    let updated;
    if (shortlisted.includes(tutorId)) {
      updated = shortlisted.filter(id => id !== tutorId);
    } else {
      updated = [...shortlisted, tutorId];
    }
    setShortlisted(updated);
    localStorage.setItem(`shortlist_${jobId}`, JSON.stringify(updated));
  };

  const handleRemoveTutor = (tutorId: number) => {
    setAnimatingOut(tutorId);
    setTimeout(() => {
      const updated = [...removed, tutorId];
      setRemoved(updated);
      localStorage.setItem(`removed_${jobId}`, JSON.stringify(updated));
      setAnimatingOut(null);
    }, 400);
  };

  const handleHireTutor = async (tutorName: string) => {
    setNotificationMsg(`✅ Success! Hire notification dispatched to ${tutorName} via internal TutorMint notification network for Job [${jobId}].`);
    setTimeout(() => setNotificationMsg(""), 5000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] space-y-4">
        <div className="w-12 h-12 border-4 border-[#d60008] border-t-transparent rounded-full animate-spin shadow-md"></div>
        <div className="text-xs font-black text-[#0F172A] uppercase tracking-widest animate-pulse">
          Fetching job details & requested tutors ⚡
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-4">
        <h2 className="text-xl font-black text-[#0F172A]">Job Not Found</h2>
        <p className="text-xs text-gray-500">The job requirement [{jobId}] does not exist or has been removed.</p>
        <Link href="/parent/dashboard" className="inline-block px-5 py-2.5 bg-[#0F172A] text-white text-xs font-bold rounded-xl">
          Back to Dashboard ➔
        </Link>
      </div>
    );
  }

  const activeTutors = availableTutors.filter(t => !removed.includes(t.id));

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155]">
      
      {/* HIERARCHY BREADCRUMBS */}
      <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <Link href="/parent/dashboard" className="hover:text-[#0F172A] transition-colors">Parent Dashboard</Link>
        <span className="text-gray-300">/</span>
        <span className="text-[#059669] font-mono">Job [{job.job_tx_id}]</span>
      </nav>

      {notificationMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-bold shadow-sm animate-in fade-in">
          {notificationMsg}
        </div>
      )}

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-mono font-bold rounded-full uppercase">
            Requirement ID: {job.job_tx_id}
          </span>
          <span className="text-xs font-bold text-slate-500 uppercase">Status: {job.status || 'Active'}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">{job.title}</h1>
        <p className="text-xs sm:text-sm text-gray-600 font-medium">
          {job.subject} • {job.grade} • Budget: <strong className="text-[#059669]">{job.budget}</strong>
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">
            Requested & Matched Tutors for this Job ({activeTutors.length})
          </h2>
          <span className="text-[11px] text-gray-500 font-medium">
            Shortlisted Favorites: {shortlisted.length}
          </span>
        </div>

        {activeTutors.length === 0 ? (
          <div className="bg-white p-8 rounded-3xl border border-gray-200 text-center space-y-2">
            <p className="text-xs font-bold text-gray-500">All requested tutors have been removed from this list.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeTutors.map((tutor) => {
              const isShortlisted = shortlisted.includes(tutor.id);
              const isAnimating = animatingOut === tutor.id;

              return (
                <div 
                  key={tutor.id} 
                  className={`bg-white p-5 rounded-3xl border ${isShortlisted ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-gray-200'} shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 transition-all duration-400 transform ${isAnimating ? 'opacity-0 scale-95 -translate-y-4' : 'opacity-100 scale-100 translate-y-0'}`}
                >
                  <div className="flex items-start gap-4 w-full sm:w-auto">
                    <img src={tutor.image} alt={tutor.name} className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-[#0F172A]">{tutor.name}</h4>
                        {isShortlisted && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-bold uppercase rounded-full">
                            ⭐ Shortlisted Favorite
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-[#059669]">Expert in {tutor.subject} ({tutor.grade})</p>
                      <p className="text-[11px] text-gray-600 font-medium">🎓 {tutor.degree} • 📍 {tutor.area}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                    <button
                      onClick={() => toggleShortlist(tutor.id)}
                      className={`px-3 py-2.5 text-xs font-bold rounded-xl border transition-all ${isShortlisted ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                    >
                      {isShortlisted ? '⭐ Favorited' : '☆ Shortlist'}
                    </button>
                    <button
                      onClick={() => router.push(`/chat/${jobId}`)}
                      className="px-3.5 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-md"
                    >
                      💬 Chat
                    </button>
                    <button
                      onClick={() => handleRemoveTutor(tutor.id)}
                      className="px-3 py-2.5 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 text-xs font-bold rounded-xl transition-all"
                      title="Remove from list"
                    >
                      ✕ Remove
                    </button>
                    <button 
                      onClick={() => handleHireTutor(tutor.name)}
                      className="px-5 py-2.5 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl transition-all whitespace-nowrap shadow-md"
                    >
                      HIRE ➔
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}