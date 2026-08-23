"use client";

import { useState, useEffect, useRef } from "react";
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
  const [messages, setMessages] = useState<any[]>([
    {
      sender: "system",
      text: `Secure chat channel initialized for requirement ${jobId}. You can now coordinate demo classes and terms directly.`,
      time: "Just now",
      avatar: "🛡️"
    },
    {
      sender: "tutor",
      name: "Ayesha Khan",
      text: "Hello! I saw your requirement and I am very interested in teaching mathematics for this grade level.",
      time: "2 mins ago",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
    }
  ]);
  const [inputText, setInputText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchJob();
    const savedMessages = localStorage.getItem(`chat_msgs_${jobId}`);
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages));
    }
  }, [jobId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg = {
      sender: "parent",
      name: "Parent",
      text: inputText,
      time: "Just now",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"
    };

    const updated = [...messages, newMsg];
    setMessages(updated);
    localStorage.setItem(`chat_msgs_${jobId}`, JSON.stringify(updated));
    setInputText("");

    setTimeout(() => {
      const replyMsg = {
        sender: "tutor",
        name: "Ayesha Khan",
        text: "Thanks for your message! Let's schedule a trial demo class at your earliest convenience.",
        time: "Just now",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
      };
      setMessages(prev => {
        const next = [...prev, replyMsg];
        localStorage.setItem(`chat_msgs_${jobId}`, JSON.stringify(next));
        return next;
      });
    }, 1000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] space-y-4">
        <div className="w-12 h-12 border-4 border-[#d60008] border-t-transparent rounded-full animate-spin shadow-md"></div>
        <div className="text-xs font-black text-[#0F172A] uppercase tracking-widest animate-pulse">
          Connecting secure chat room 💬
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
      
      {/* HIERARCHY BREADCRUMBS */}
      <nav className="flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <Link href="/parent/dashboard" className="hover:text-[#0F172A] transition-colors">Parent Dashboard</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/parent/dashboard/job/${job.job_tx_id || jobId}`} className="hover:text-[#0F172A] transition-colors font-mono">Job [{job.job_tx_id || jobId}]</Link>
        <span className="text-gray-300">/</span>
        <span className="text-[#d60008]">Live Discussion</span>
      </nav>

      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-2">
        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
          {job.job_tx_id}
        </span>
        <h1 className="text-xl font-black text-[#0F172A]">{job.title}</h1>
        <p className="text-xs text-gray-600">{job.subject} • {job.grade} • Budget: {job.budget}</p>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm h-[480px] flex flex-col justify-between">
        <div className="space-y-4 overflow-y-auto flex-1 pr-3">
          {messages.map((m, idx) => {
            if (m.sender === "system") {
              return (
                <div key={idx} className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-900 max-w-lg mx-auto text-center font-medium">
                  🛡️ {m.text}
                </div>
              );
            }

            const isParent = m.sender === "parent";

            return (
              <div key={idx} className={`flex items-end gap-3 ${isParent ? "justify-end" : "justify-start"}`}>
                {!isParent && (
                  <img src={m.avatar} alt={m.name} className="w-9 h-9 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                )}

                <div className={`p-4 rounded-3xl max-w-[75%] text-xs leading-relaxed ${isParent ? "bg-[#d60008] text-white rounded-br-none shadow-md" : "bg-[#F8FAFC] text-[#334155] border border-gray-200 rounded-bl-none shadow-2xs"}`}>
                  <div className="flex items-center justify-between gap-4 mb-1">
                    <span className={`font-black text-[10px] uppercase ${isParent ? "text-red-100" : "text-[#0F172A]"}`}>{m.name}</span>
                    <span className={`text-[9px] ${isParent ? "text-red-200" : "text-gray-400"}`}>{m.time}</span>
                  </div>
                  <p className="font-medium">{m.text}</p>
                </div>

                {isParent && (
                  <img src={m.avatar} alt={m.name} className="w-9 h-9 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>
        
        <form onSubmit={handleSendMessage} className="pt-4 border-t border-gray-100 flex gap-2">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message to the tutor..." 
            className="flex-1 bg-[#F8FAFC] border border-gray-200 rounded-xl p-3 text-xs outline-none focus:bg-white focus:border-[#0F172A]"
          />
          <button type="submit" className="px-6 py-3 bg-[#d60008] hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition-all">
            Send ➔
          </button>
        </form>
      </div>
    </main>
  );
}