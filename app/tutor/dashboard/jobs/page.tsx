"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TutorJobBoardPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCity, setSelectedCity] = useState("All");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchActiveJobs();
  }, []);

  const fetchActiveJobs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Even if not strictly forced to login to view, tutors can browse. 
      // But for applying, we want them logged in.

      const { data, error } = await supabase
        .from('parent_jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (err) {
      console.error("Error fetching job board:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (job: any) => {
    try {
      setActionLoading(job.job_tx_id || job.id);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        alert("🔒 Please log in as a tutor to apply for this job requirement.");
        router.push('/tutor/login');
        return;
      }

      const jobId = job.job_tx_id || job.id;

      // Insert an introductory message into the messages table to start the thread
      const { error: msgError } = await supabase.from('messages').insert({
        job_id: jobId,
        sender: user.email || "Tutor",
        message: `Hello! I am an expert tutor interested in your requirement for ${job.subject} (${job.grade}). Let's discuss details.`
      });

      if (msgError) console.error("Error sending application message:", msgError);

      alert("🎉 Application sent successfully! Redirecting you to the chat thread.");
      router.push(`/chat/${jobId}`);
    } catch (err: any) {
      alert(`Error applying: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = 
      (job.title && job.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (job.subject && job.subject.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (job.grade && job.grade.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCity = selectedCity === "All" || (job.city && job.city.toLowerCase() === selectedCity.toLowerCase());

    const isClosed = job.status?.toLowerCase() === 'closed';

    return matchesSearch && matchesCity && !isClosed;
  });

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155] font-sans">
      
      {/* BREADCRUMBS */}
      <nav className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-gray-500">
          <Link href="/tutor/dashboard" className="hover:text-[#0F172A] transition-colors">Tutor Dashboard</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Available Job Board</span>
        </div>
        <Link 
          href="/tutor/dashboard/settings"
          className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] text-xs font-bold rounded-xl transition-all shadow-2xs"
        >
          ⚙️ Settings
        </Link>
      </nav>

      {/* HEADER */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">Parent Job Board 📋</h1>
        <p className="text-xs sm:text-sm text-gray-600 font-medium">
          Explore active tutoring requirements posted by parents across Pakistan. Apply instantly and start teaching.
        </p>
      </div>

      {/* FILTERS BAR */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <input 
          type="text" 
          placeholder="Search by subject, grade, or title..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:w-96 p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#0F172A]"
        />

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-gray-500 whitespace-nowrap">City:</span>
          <select 
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="w-full sm:w-48 p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#0F172A]"
          >
            <option value="All">All Cities</option>
            <option value="Lahore">Lahore</option>
            <option value="Karachi">Karachi</option>
            <option value="Islamabad">Islamabad</option>
            <option value="Multan">Multan</option>
          </select>
        </div>
      </div>

      {/* JOBS FEED */}
      <div className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A] px-2">
          Active Requirements ({filteredJobs.length})
        </h2>

        {loading ? (
          <div className="flex justify-center items-center py-16">
            <div className="w-8 h-8 border-3 border-[#d60008] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-gray-200 text-center space-y-2 shadow-sm">
            <p className="text-xs font-bold text-gray-500">No active job listings match your current filters.</p>
            <p className="text-[11px] text-gray-400">Try adjusting your search terms or check back later for new postings!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredJobs.map((job) => {
              const jobId = job.job_tx_id || job.id;
              const isBusy = actionLoading === jobId;

              return (
                <div 
                  key={jobId}
                  className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:border-gray-300"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
                        {jobId}
                      </span>
                      <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                        📍 {job.city}, {job.area}
                      </span>
                      <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-md">
                        💰 Budget: {job.budget}
                      </span>
                    </div>

                    <h3 className="text-base font-black text-[#0F172A]">{job.title}</h3>
                    <p className="text-xs text-gray-600 font-medium leading-relaxed">{job.description}</p>
                    
                    <div className="text-[11px] text-gray-400 font-semibold">
                      Grade: <strong className="text-gray-700">{job.grade}</strong> • Subjects: <strong className="text-gray-700">{job.subject}</strong>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto shrink-0">
                    <button
                      onClick={() => handleApply(job)}
                      disabled={isBusy}
                      className="w-full sm:w-auto px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-extrabold rounded-xl shadow-md transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      {isBusy ? "Applying..." : "Apply & Chat ➔"}
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