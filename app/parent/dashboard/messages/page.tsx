"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ParentMessagesInboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/parent/login');
        return;
      }

      const { data: jobs, error: jobsError } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('parent_id', user.id);

      if (jobsError) throw jobsError;

      if (!jobs || jobs.length === 0) {
        setLoading(false);
        return;
      }

      const jobIds = jobs.map(j => j.job_tx_id || j.id);

      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('*')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });

      if (msgError) throw msgError;

      const threadMap = new Map();
      for (const job of jobs) {
        const jId = job.job_tx_id || job.id;
        const jobMsgs = (messages || []).filter(m => m.job_id === jId);
        
        threadMap.set(jId, {
          jobId: jId,
          jobTitle: job.title,
          grade: job.grade,
          subject: job.subject,
          messages: jobMsgs,
          lastMessage: jobMsgs[0] ? jobMsgs[0].message : "No messages yet",
          lastTime: jobMsgs[0] ? jobMsgs[0].created_at : job.created_at,
          tutorName: jobMsgs.find(m => m.sender !== user.email)?.sender || "Assigned Tutor"
        });
      }

      setConversations(Array.from(threadMap.values()));
    } catch (err) {
      console.error("Error fetching conversations:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155]">
      
      {/* BREADCRUMBS */}
      <nav className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-gray-500">
          <Link href="/parent/dashboard" className="hover:text-[#0F172A] transition-colors">Parent Dashboard</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Messages Inbox</span>
        </div>
        <Link 
          href="/parent/dashboard/settings"
          className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 border border-gray-200 shadow-2xs"
        >
          <span>⚙️ Account Settings</span>
        </Link>
      </nav>

      {/* HEADER */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">
            Messages & Conversations Inbox 💬
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Manage all active discussions with tutors across your posted requirements.
          </p>
        </div>
        <Link 
          href="/parent/dashboard"
          className="px-4 py-2.5 bg-[#F8FAFC] hover:bg-gray-200 text-[#334155] text-xs font-bold rounded-xl border border-gray-200 transition-colors whitespace-nowrap"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* THREADS LIST */}
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">
          Active Chat Threads ({conversations.length})
        </h2>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="w-8 h-8 border-3 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12 bg-[#F8FAFC] rounded-2xl border border-gray-100 space-y-2">
            <p className="text-xs text-gray-500 font-medium">No active chat threads found.</p>
            <p className="text-[11px] text-gray-400">Invite a tutor from any job requirement to start chatting!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((thread) => (
              <div 
                key={thread.jobId}
                onClick={() => router.push(`/chat/${thread.jobId}?tutor=${encodeURIComponent(thread.tutorName)}`)}
                className="p-5 bg-[#F8FAFC] hover:bg-slate-100 border border-gray-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 cursor-pointer transition-all group"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
                      Job ID: {thread.jobId}
                    </span>
                    <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                      Requirement: {thread.jobTitle}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-[#0F172A] group-hover:text-[#059669] transition-colors">
                    Chat with {thread.tutorName}
                  </h4>
                  <p className="text-xs text-gray-600 truncate max-w-xl">
                    <strong className="text-gray-800">Latest:</strong> {thread.lastMessage}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-[10px] font-semibold text-gray-400">
                    {thread.lastTime ? new Date(thread.lastTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                  <span className="px-4 py-2 bg-[#0F172A] group-hover:bg-[#059669] text-white text-xs font-bold rounded-xl transition-all shadow-xs">
                    Open Chat ➔
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </main>
  );
}