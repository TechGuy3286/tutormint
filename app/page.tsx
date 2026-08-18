"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

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
        botReply = "You can click 'Browse Tutors' or post a personalized job requirement on our parent dashboard so exact-match tutors can contact you!";
      }

      setMessages((prev) => [...prev, { sender: "bot", text: botReply }]);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#000000] flex flex-col justify-between relative">
      {/* Navbar Component */}
      <Navbar />

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-6 py-10 sm:py-16 space-y-10 flex-1 w-full">
        
        {/* HERO HEADING */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight text-[#000000]">
            Find Verified & Trusted<br />
            Tutors <span className="text-[#d60008]">FREE</span>
          </h1>
        </div>

        {/* SECTION: FOR PARENTS */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 text-center sm:text-left">
            For Parents
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Square Button 1: Find Tutor (Navy Blue Background) */}
            <Link 
              href="/parent/dashboard" 
              className="p-6 bg-[#1f1f7a] hover:bg-[#16165c] text-white rounded-2xl shadow-lg shadow-[#1f1f7a]/30 transition-all flex flex-col items-center sm:items-start justify-between text-center sm:text-left group"
            >
              <div className="text-2xl mb-2">🔍</div>
              <div>
                <h4 className="text-sm font-black text-white group-hover:text-gray-200 transition-colors">Find Tutor</h4>
                <p className="text-xs text-blue-100 mt-1">Browse camera-verified educators instantly.</p>
              </div>
            </Link>

            {/* Square Button 2: Post a Tuition/Job (Mint Green Background) */}
            <Link 
              href="/parent/dashboard" 
              className="p-6 bg-[#98FB98] hover:bg-[#85e685] text-[#000000] rounded-2xl shadow-lg shadow-emerald-200/50 transition-all flex flex-col items-center sm:items-start justify-between text-center sm:text-left group"
            >
              <div className="text-2xl mb-2">📋</div>
              <div>
                <h4 className="text-sm font-black text-[#000000] transition-colors">Post a Tuition / Job</h4>
                <p className="text-xs text-gray-800 mt-1">Receive custom quotes from qualified tutors.</p>
              </div>
            </Link>
          </div>
        </div>

        {/* SECTION: FOR TUTORS */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 text-center sm:text-left">
            For Tutors
          </h3>
          {/* Big Horizontal Button (Black Background with Red Shadow Accent) */}
          <Link 
            href="/tutor/register" 
            className="w-full p-5 bg-[#000000] hover:bg-gray-900 text-white rounded-2xl shadow-lg shadow-[#d60008]/30 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🎓</span>
              <div className="text-left">
                <h4 className="text-sm font-black uppercase tracking-wider text-white group-hover:text-gray-200 transition-colors">Find Tuition</h4>
                <p className="text-[11px] text-gray-400 font-medium">Register, upload video proof & get verified</p>
              </div>
            </div>
            <span className="text-lg font-bold pr-2 text-[#d60008] group-hover:translate-x-1 transition-transform">➔</span>
          </Link>
        </div>

      </main>

      {/* FLOATING CHATBOT WIDGET */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen ? (
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-80 sm:w-96 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-[#000000] text-white p-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#98FB98] rounded-full animate-pulse"></span>
                <div>
                  <h4 className="text-xs font-black">TutorMint Assistant</h4>
                  <p className="text-[10px] text-gray-400">Ask anything about verified tutors</p>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white font-bold text-sm px-2">✕</button>
            </div>

            <div className="p-4 h-80 overflow-y-auto space-y-3 bg-gray-50 text-xs flex flex-col">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`p-3 rounded-2xl max-w-[80%] leading-relaxed ${m.sender === "user" ? "bg-[#d60008] text-white rounded-br-none" : "bg-white text-gray-800 border border-gray-200 rounded-bl-none shadow-2xs"}`}>
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
                className="flex-1 p-2.5 bg-gray-100 rounded-xl text-xs border border-transparent focus:border-gray-300 focus:bg-white outline-none"
              />
              <button type="submit" className="px-4 py-2.5 bg-[#d60008] hover:bg-[#b50007] text-white text-xs font-bold rounded-xl transition-colors">
                Send ➔
              </button>
            </form>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-[#d60008] hover:bg-[#b50007] text-white p-4 rounded-full shadow-2xl flex items-center gap-2 font-extrabold text-xs transition-all hover:scale-105 group relative"
          >
            <span className="text-lg">💬</span>
            <span className="hidden sm:inline pr-1">Need Help? Chat with Us</span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#98FB98] rounded-full animate-ping"></span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#98FB98] rounded-full"></span>
          </button>
        )}
      </div>

      {/* Footer Component */}
      <Footer />
    </div>
  );
}