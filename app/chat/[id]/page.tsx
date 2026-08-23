"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function ChatPage() {
  const params = useParams();
  const jobId = params.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJob();
  }, [jobId]);

  const fetchJob = async () => {
    try {
      const { data, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('job_tx_id', jobId)
        .single();

      if (error) {
        const { data: dataById } = await supabase
          .from('parent_jobs')
          .select('*')
          .eq('id', jobId)
          .single();
        setJob(dataById);
      } else {
        setJob(data);
      }
    } catch (err) {
      console.error("Error fetching job for chat:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading chat room...
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

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 flex-1 w-full text-[#334155]">
      <div>
        <Link href={`/parent/dashboard/job/${job.job_tx_id || jobId}`} className="text-xs font-bold text-gray-500 hover:text-[#0F172A] transition-colors">
          ← Back to Job Details
        </Link>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-2">
        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
          {job.job_tx_id}
        </span>
        <h1 className="text-xl font-black text-[#0F172A]">{job.title}</h1>
        <p className="text-xs text-gray-600">{job.subject} • {job.grade} • Budget: {job.budget}</p>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm h-96 flex flex-col justify-between">
        <div className="space-y-3 overflow-y-auto flex-1 pr-2">
          <div className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-2xl text-xs max-w-[80%]">
            <p className="font-bold text-[#0F172A] mb-1">System Notice</p>
            Secure chat channel initialized for requirement <strong>{job.job_tx_id}</strong>. You can now coordinate demo classes and terms directly.
          </div>
        </div>
        
        <div className="pt-4 border-t border-gray-100 flex gap-2">
          <input 
            type="text" 
            placeholder="Type your message to the tutor..." 
            className="flex-1 bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs outline-none focus:bg-white focus:border-[#0F172A]"
          />
          <button className="px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition-all">
            Send ➔
          </button>
        </div>
      </div>
    </main>
  );
}