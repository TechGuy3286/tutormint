"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

export default function ParentDashboardPage() {
  const [userEmail, setUserEmail] = useState("");
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingRole, setLoadingRole] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    verifyRoleAndFetchData();
  }, []);

  const verifyRoleAndFetchData = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        router.replace('/parent/login');
        return;
      }
      setUserEmail(user.email || "Test Parent");

      const { data: jobsData, error: jobsError } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('parent_id', user.id)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;
      setMyJobs(jobsData || []);

    } catch (err: any) {
      console.error("Error fetching data:", err.message);
    } finally {
      setLoadingRole(false);
      setLoadingJobs(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/parent/login');
  };

  const handleProtectedAction = async (actionType: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/parent/login");
      return;
    }

    if (actionType === "post-job") {
      router.push("/parent/dashboard/post-job");
    }
  };

  const acceptedJobs = myJobs.filter(j => j.status === 'Accepted by Tutor' || j.status === 'Pending Tutor Acceptance');

  if (loadingRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] space-y-4">
        <div className="w-12 h-12 border-4 border-[#d60008] border-t-transparent rounded-full animate-spin shadow-md"></div>
        <div className="text-xs font-black text-[#0F172A] uppercase tracking-widest animate-pulse">
          Preparing your dashboard ✨
        </div>
      </div>
    );
  }

  const parentName = userEmail ? userEmail.split('@')[0] : 'Test Parent';

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col text-[#334155]">
      
      {/* Top Header Bar with Welcome & Dashboard Quick Link */}
      <header className="bg-white border-b border-gray-200 py-4 px-6 sm:px-12 flex items-center justify-between">
        <Link href="/" className="text-lg font-black text-[#0F172A]">TutorMint</Link>
        <div className="flex items-center gap-3 text-xs font-bold">
          <span className="text-gray-600">Welcome, {parentName}</span>
          <span className="text-gray-300">|</span>
          <Link href="/parent/dashboard" className="text-[#059669] hover:underline font-extrabold">Dashboard</Link>
          <span className="text-gray-300">|</span>
          <button onClick={handleLogout} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] rounded-xl transition-colors">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full">
        
        {/* LIVE NOTIFICATION CENTER */}
        <div className="bg-blue-50 border border-blue-200 p-5 rounded-3xl space-y-3 shadow-xs">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-black text-blue-900 uppercase flex items-center gap-2">
              <span>🔔 Live Notification Center</span>
              <span className="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px]">{acceptedJobs.length}</span>
            </h4>
          </div>

          {acceptedJobs.length > 0 ? (
            <div className="space-y-2">
              {acceptedJobs.map(job => (
                <div key={job.job_tx_id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-blue-100">
                  <p className="text-xs text-blue-900 font-medium">
                    Requirement <span className="font-mono font-bold">[{job.job_tx_id}]</span> status is: <strong className="text-[#059669] uppercase">{job.status}</strong>
                  </p>
                  <Link 
                    href={`/parent/dashboard/job/${job.job_tx_id}`}
                    className="px-3 py-1.5 bg-[#059669] text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-all"
                  >
                    View Job & Tutors ➔
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-3.5 rounded-2xl border border-blue-100 text-xs text-blue-800 font-medium flex items-center justify-between">
              <span>No demo class acceptances or active alerts right now. When a tutor accepts your requirement, you'll be notified here.</span>
              <span className="text-blue-400 font-mono text-[10px]">Active & Listening</span>
            </div>
          )}
        </div>

        {/* Dashboard Header */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">
              Parent Dashboard
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Manage your posted requirements or browse verified tutors directly with zero middlemen.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Link 
              href="/parent/dashboard/settings"
              className="px-4 py-3 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <span>⚙️ Account Settings</span>
            </Link>
            <button 
              onClick={() => handleProtectedAction("post-job")}
              className="px-5 py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <span>📋 Post New Job Requirement</span>
            </button>
          </div>
        </div>

        {/* MY POSTED JOBS */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">
              My Posted Jobs ({myJobs.length})
            </h2>
          </div>

          {loadingJobs ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-8 h-8 border-3 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-gray-500 font-bold">Loading your active postings...</p>
            </div>
          ) : myJobs.length === 0 ? (
            <div className="text-center py-8 bg-[#F8FAFC] rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-500 font-medium">You haven't posted any jobs yet.</p>
              <button 
                onClick={() => router.push("/parent/dashboard/post-job")}
                className="mt-3 px-4 py-2 bg-[#0F172A] text-white text-xs font-bold rounded-xl hover:bg-[#059669] transition-all"
              >
                Post Your First Job →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myJobs.map((job) => {
                const isClosed = job.status === 'Closed';
                return (
                  <div 
                    key={job.job_tx_id || job.id} 
                    onClick={() => router.push(`/parent/dashboard/job/${job.job_tx_id}`)}
                    className="p-4 bg-[#F8FAFC] hover:bg-slate-100 border border-gray-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 cursor-pointer transition-all group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
                          {job.job_tx_id}
                        </span>
                        <span className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-md uppercase ${isClosed ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          Status: {job.status || 'Active'}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-[#0F172A] group-hover:text-blue-600 transition-colors">{job.title}</h4>
                      <p className="text-xs text-gray-600">{job.subject} • {job.grade} • Budget: {job.budget}</p>
                    </div>

                    <span className="px-4 py-2.5 bg-[#0F172A] group-hover:bg-[#059669] text-white text-xs font-bold rounded-xl transition-all whitespace-nowrap">
                      View Job & Tutors ➔
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}