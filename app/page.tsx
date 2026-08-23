"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

export default function HomePage() {
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    { sender: "bot", text: "Hi! Welcome to TutorMint 👋 How can I help you find a verified tutor today?" }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatOpen]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userText = inputMessage;
    const newMessages = [...messages, { sender: "user", text: userText }];
    setMessages(newMessages);
    setInputMessage("");

    setTimeout(() => {
      let botReply = "Thank you for reaching out! Our team will connect with you via WhatsApp/Call within 10 minutes.";
      const lower = userText.toLowerCase();
      
      if (lower.includes("how are you") || lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
        botReply = "Hello! I'm doing great, thank you for asking. How can I assist you with finding a verified tutor or navigating TutorMint today?";
      } else if (lower.includes("video") || lower.includes("verification") || lower.includes("verify") || lower.includes("degree")) {
        botReply = "Video verification means every tutor records a 60-second live video holding their actual physical degree. Our admins manually audit every file before approval.";
      } else if (lower.includes("price") || lower.includes("fee") || lower.includes("cost") || lower.includes("rates")) {
        botReply = "Tutor rates vary by grade level and subject (usually ranging from PKR 15,000 to 45,000/month for home tuition). You can browse tutors directly or post a job to receive custom quotes!";
      } else if (lower.includes("lahore") || lower.includes("city") || lower.includes("karachi") || lower.includes("islamabad") || lower.includes("multan")) {
        botReply = "We currently have verified tutors active in Lahore, Karachi, Islamabad, Multan, and surrounding areas.";
      } else if (lower.includes("job") || lower.includes("post")) {
        botReply = "You can click 'Find Tutor' or post a personalized job requirement on our dashboard so exact-match tutors can contact you!";
      }

      setMessages((prev) => [...prev, { sender: "bot", text: botReply }]);
    }, 600);
  };

  return (
    <div className="space-y-12 py-12 sm:py-20 max-w-3xl mx-auto px-6 w-full flex-1 flex flex-col justify-between relative">
      
      {/* Main Content */}
      <div className="space-y-12">
        
        {/* HERO HEADING & SUBTITLE */}
        <div className="text-center space-y-4">
          <span className="px-3 py-1 bg-emerald-50 text-[#059669] border border-emerald-200 text-[11px] font-bold uppercase tracking-widest rounded-full">
            Pakistan's Largest Verified Tutors Network
          </span>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight text-[#0F172A]">
            Find Verified & Trusted<br />
            Tutors <span className="text-[#d60008]">FOREVER FREE</span>
          </h1>
          <p className="text-sm text-[#334155] max-w-lg mx-auto font-medium">
            Connect directly with camera-verified home & online tutors. Zero commission, rigorous degree audits, and trusted local educators.
          </p>
        </div>

        {/* SECTION: FOR PARENTS & STUDENTS */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#334155]">
              For Parents & Students
            </h3>
            <span className="text-[10px] text-emerald-700 font-semibold uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">Forever Free Postings</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Square Button 1: Find Tutor */}
            <Link 
              href="/tutor" 
              className="p-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-lg shadow-blue-600/20 transition-all flex flex-col items-center sm:items-start justify-between text-center sm:text-left group"
            >
              <div className="text-2xl mb-2 p-3 bg-white/10 rounded-xl w-fit">🔍</div>
              <div>
                <h4 className="text-sm font-black text-white group-hover:text-blue-100 transition-colors">Find Tutor</h4>
                <p className="text-xs text-blue-100 mt-1">Browse camera-verified educators instantly.</p>
              </div>
            </Link>

            {/* Square Button 2: Post a Tuition/Job (Points to public /parent/post-job filter page) */}
            <Link 
              href="/parent/post-job" 
              className="p-6 bg-[#059669] hover:bg-emerald-700 text-white rounded-2xl shadow-lg shadow-emerald-600/20 transition-all flex flex-col items-center sm:items-start justify-between text-center sm:text-left group"
            >
              <div className="text-2xl mb-2 p-3 bg-white/10 rounded-xl w-fit">📋</div>
              <div>
                <h4 className="text-sm font-black text-white transition-colors">Post a Tuition / Job</h4>
                <p className="text-xs text-emerald-100 mt-1">Receive custom quotes from qualified tutors.</p>
              </div>
            </Link>
          </div>
        </div>

        {/* SECTION: FOR EDUCATORS & TUTORS */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#334155]">
              For Educators & Tutors
            </h3>
            <span className="text-[10px] text-[#059669] font-bold uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
              Forever Free Platform
            </span>
          </div>

          {/* Big Horizontal Button */}
          <Link 
            href="/tutor/register" 
            className="w-full p-6 bg-[#0F172A] hover:bg-black text-white rounded-2xl shadow-xl shadow-slate-900/10 border border-slate-800 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <span className="text-2xl p-3 bg-white/10 rounded-xl">🎓</span>
              <div className="text-left">
                <h4 className="text-sm font-black uppercase tracking-wider text-white group-hover:text-red-400 transition-colors">Find Tuition & Register Profile</h4>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">Upload video proof, get verified & connect with local parents</p>
              </div>
            </div>
            <span className="text-xl font-bold pr-2 text-[#d60008] group-hover:translate-x-1.5 transition-transform">➔</span>
          </Link>
        </div>

      </div>

      {/* FLOATING CHATBOT WIDGET */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen ? (
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-80 sm:w-96 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-[#0F172A] text-white p-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#059669] rounded-full animate-pulse"></span>
                <div>
                  <h4 className="text-xs font-black">TutorMint Assistant</h4>
                  <p className="text-[10px] text-slate-300">Ask anything about verified tutors</p>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-white font-bold text-sm px-2">✕</button>
            </div>

            <div className="p-4 h-80 overflow-y-auto space-y-3 bg-[#F8FAFC] text-xs flex flex-col">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`p-3 rounded-2xl max-w-[80%] leading-relaxed ${m.sender === "user" ? "bg-[#d60008] text-white rounded-br-none" : "bg-white text-[#334155] border border-gray-200 rounded-bl-none shadow-2xs"}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-gray-100 flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your question here..."
                className="flex-1 p-2.5 bg-[#F8FAFC] text-[#334155] rounded-xl text-xs border border-gray-200 focus:border-[#0F172A] focus:bg-white outline-none"
              />
              <button type="submit" className="px-4 py-2.5 bg-[#d60008] hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-colors">
                Send ➔
              </button>
            </form>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-[#d60008] hover:bg-red-700 text-white p-4 rounded-full shadow-2xl flex items-center gap-2 font-extrabold text-xs transition-all hover:scale-105 group relative"
          >
            <span className="text-lg">💬</span>
            <span className="hidden sm:inline pr-1">Need Help? Chat with Us</span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#059669] rounded-full animate-ping"></span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#059669] rounded-full"></span>
          </button>
        )}
      </div>

    </div>
  );
}