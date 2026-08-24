"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function EditJobPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (jobId) fetchJob();
  }, [jobId]);

  const fetchJob = async () => {
    try {
      const { data, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('job_tx_id', jobId)
        .single();

      if (error) throw error;
      if (data) {
        if (data.status?.toLowerCase() === 'closed') {
          alert("Closed jobs cannot be edited.");
          router.push(`/parent/dashboard/job/${jobId}`);
          return;
        }
        setTitle(data.title || "");
        setSubject(data.subject || "");
        setGrade(data.grade || "");
        setBudget(data.budget || "");
      }
    } catch (err) {
      console.error("Error fetching job for edit:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('parent_jobs')
        .update({ title, subject, grade, budget })
        .eq('job_tx_id', jobId);

      if (error) throw error;

      setSuccessMsg("✨ Job requirement updated successfully!");
      setTimeout(() => {
        router.push(`/parent/dashboard/job/${jobId}`);
      }, 1500);
    } catch (err: any) {
      alert(`Error updating job: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="w-8 h-8 border-3 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6 flex-1 w-full text-[#334155]">
      <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <Link href={`/parent/dashboard/job/${jobId}`} className="hover:text-[#0F172A]">Job [{jobId}]</Link>
        <span className="text-gray-300">/</span>
        <span className="text-[#059669]">Edit Requirements</span>
      </nav>

      {successMsg && (
        <div className="p-4 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-2xl border border-emerald-200">
          {successMsg}
        </div>
      )}

      <form onSubmit={handleUpdateJob} className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-5">
        <h1 className="text-xl font-black text-[#0F172A]">Edit Job Requirement [{jobId}]</h1>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-700">Job Title</label>
          <input 
            type="text" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)} 
            required
            className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-semibold text-[#1E293B] outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-700">Subject</label>
          <input 
            type="text" 
            value={subject} 
            onChange={(e) => setSubject(e.target.value)} 
            required
            className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-semibold text-[#1E293B] outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-700">Grade / Level</label>
          <input 
            type="text" 
            value={grade} 
            onChange={(e) => setGrade(e.target.value)} 
            required
            className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-semibold text-[#1E293B] outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-700">Budget</label>
          <input 
            type="text" 
            value={budget} 
            onChange={(e) => setBudget(e.target.value)} 
            required
            className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-semibold text-[#1E293B] outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-4">
          <Link href={`/parent/dashboard/job/${jobId}`} className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl">
            Cancel
          </Link>
          <button 
            type="submit" 
            disabled={submitting}
            className="px-6 py-2.5 bg-[#d60008] hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-md"
          >
            {submitting ? 'Saving...' : 'Save Changes 🚀'}
          </button>
        </div>
      </form>
    </main>
  );
}