"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ParentDashboardPage() {
  const [userEmail, setUserEmail] = useState("");
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingRole, setLoadingRole] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    verifyRoleAndFetchData();
  }, [router]);

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
      
      // Merge with local storage hired status to ensure instant UI reflection
      const enrichedJobs = (jobsData || []).map(job => {
        const isLocallyClosed = localStorage.getItem(`hired_tutor_${job.job_tx_id}`) || localStorage.getItem(`hired_tutor_${job.id}`);
        if (isLocallyClosed) {
          return { ...job, status: 'Closed' };
        }
        return job;
      });

      setMyJobs(enrichedJobs);

    } catch (err: any) {
      console.error("Error fetching data:", err.message);
    } finally {
      setLoadingRole(false);
      setLoadingJobs(false);
    }
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

  const activeJobsCount = myJobs.filter(j => j.status?.toLowerCase() !== 'closed').length;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155]">
      
      {/* Clean Breadcrumb Navigation */}
      <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <Link href="/" className="hover:text-[#0F172A] transition-colors">Home</Link>
        <span className="text-gray-300">/</span>
        <span className="text-[#059669]">Parent Dashboard</span>
      </nav>

      {/* Dashboard Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">
            Parent Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Manage your posted requirements ({activeJobsCount} Active Jobs) or browse verified tutors directly.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
          <Link 
            href="/parent/dashboard/hired-tutors"
            className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span>🎓 My Hired Tutors</span>
          </Link>
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
            <span>📋 Post Job</span>
          </button>
        </div>
      </div>

      {/* MY POSTED JOBS */}
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">
            My Posted Jobs ({myJobs.length}) • Active: {activeJobsCount}
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
              const isClosed = job.status?.toLowerCase() === 'closed';
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
                        Status: {isClosed ? 'CLOSED' : (job.status || 'Active')}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-[#0F172A] group-hover:text-blue-600 transition-colors">{job.title}</h4>
                    <p className="text-xs text-gray-600">{job.subject} • {job.grade} • Budget: {job.budget}</p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    {!isClosed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/parent/dashboard/job/${job.job_tx_id}/edit`);
                        }}
                        className="px-3.5 py-2.5 bg-gray-200 hover:bg-gray-300 text-[#0F172A] text-xs font-bold rounded-xl transition-all whitespace-nowrap shadow-xs"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    <span className="px-4 py-2.5 bg-[#0F172A] group-hover:bg-[#059669] text-white text-xs font-bold rounded-xl transition-all whitespace-nowrap shadow-xs">
                      View Job & Tutors ➔
                    </span>
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