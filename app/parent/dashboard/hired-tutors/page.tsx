"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HiredTutorsPage() {
  const [hiredList, setHiredList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchHiredTutors();
  }, []);

  const fetchHiredTutors = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/parent/login');
        return;
      }

      // Fetch closed/hired jobs for this parent
      const { data: jobs, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('parent_id', user.id);

      if (error) throw error;

      // Extract hired tutors from local storage / job data mapping
      const hiredTutorsData: any[] = [];
      (jobs || []).forEach(job => {
        const isClosed = job.status?.toLowerCase() === 'closed';
        const hiredId = localStorage.getItem(`hired_tutor_${job.job_tx_id}`) || localStorage.getItem(`hired_tutor_${job.id}`);
        const hiredName = localStorage.getItem(`hired_tutor_name_${job.job_tx_id}`) || localStorage.getItem(`hired_tutor_name_${job.id}`);

        if (isClosed || hiredId || hiredName) {
          hiredTutorsData.push({
            jobId: job.job_tx_id,
            jobTitle: job.title,
            subject: job.subject,
            grade: job.grade,
            budget: job.budget,
            tutorName: hiredName || "Verified Hired Tutor",
            tutorId: hiredId || "1",
            dateClosed: job.updated_at || job.created_at
          });
        }
      });

      setHiredList(hiredTutorsData);
    } catch (err) {
      console.error("Error fetching hired tutors:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155]">
      <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <Link href="/parent/dashboard" className="hover:text-[#0F172A] transition-colors">Parent Dashboard</Link>
        <span className="text-gray-300">/</span>
        <span className="text-[#059669]">Hired Tutors Directory</span>
      </nav>

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">My Hired Tutors</h1>
        <p className="text-xs sm:text-sm text-gray-600 font-medium">
          Standalone directory of all tutors you have successfully hired across your closed job requirements.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-3 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : hiredList.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-gray-200 text-center space-y-3">
          <p className="text-xs font-bold text-gray-500">You haven't hired any tutors yet.</p>
          <Link href="/browse" className="inline-block px-5 py-2.5 bg-[#d60008] text-white text-xs font-bold rounded-xl shadow-md">
            Browse & Hire Tutors ➔
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hiredList.map((item, idx) => (
            <div key={idx} className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
                    {item.jobId}
                  </span>
                  <span className="px-2.5 py-0.5 bg-red-100 text-red-800 text-[10px] font-extrabold rounded-md uppercase">
                    🎉 Hired
                  </span>
                </div>
                <h3 className="text-base font-black text-[#0F172A]">{item.tutorName}</h3>
                <p className="text-xs font-bold text-[#059669]">Job: {item.jobTitle}</p>
                <p className="text-xs text-gray-600 font-medium">{item.subject} • {item.grade} • Budget: {item.budget}</p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => router.push(`/parent/dashboard/job/${item.jobId}`)}
                  className="flex-1 px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl transition-all text-center"
                >
                  💬 Open Chat & Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}