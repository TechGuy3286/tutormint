"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const heroVariations = [
  {
    tag: "🛡️ ZERO FAKE CREDENTIALS • 100% CAMERA VERIFIED",
    titlePrefix: "Find Trusted, Camera-Verified Home Tutors in ",
    highlight: "Pakistan",
    description: "Eliminate uncertainty. Every educator on TutorMint records a live 60-second video introduction showcasing their actual degrees on camera, rigorously reviewed."
  },
  {
    tag: "🎓 Pakistan's Largest Tutors Database",
    titlePrefix: "Hire Verified, Camera-Audited Tutors ",
    highlight: "Instantly & Securely",
    description: "Your child's safety and education deserve real credentials, not unvetted strangers. Browse background-checked teachers with verified academic proofs."
  },
  {
    tag: "🏫 DESIGNED FOR PARENTS & TOP SCHOOLS",
    titlePrefix: "The Smarter Way to Secure ",
    highlight: "Qualified Teaching Talent",
    description: "Whether you're a parent protecting your child's future or an academy seeking reliable staff, TutorMint delivers pre-screened educators ready to excel."
  },
  {
    tag: "✨ REAL DEGREES • REAL VIDEO PROOF • ZERO RISK",
    titlePrefix: "Discover Top-Rated Home Tutors Across ",
    highlight: "All Major Cities",
    description: "From Lahore to Islamabad, Karachi to Multan—connect with elite, camera-verified educators who meet the highest standards of academic excellence."
  }
];

export default function HomePage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"verification" | "safety" | "matching">("verification");

  // Chatbot State
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    { sender: "bot", text: "Hi! Welcome to TutorMint 👋 How can I help you find a verified tutor today?" }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % heroVariations.length);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

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

    // Improved smart chatbot response logic with accurate keyword routing
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

  const hero = heroVariations[currentIndex];

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col justify-between relative">
      {/* Top Header / Navigation */}
      <header className="bg-white border-b border-gray-200 px-6 sm:px-12 py-4 flex justify-between items-center sticky top-0 z-40 shadow-xs">
        <Link href="/" className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <span>Tutor<span className="text-[#B3191F]">Mint</span></span>
          <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded uppercase font-bold">Pakistan</span>
        </Link>
        <div className="flex items-center space-x-3">
          <Link href="/parent/dashboard" className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xs font-bold rounded-xl transition-colors">
            Browse Tutors 🔍
          </Link>
          <Link href="/tutor/register" className="px-4 py-2 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl shadow-sm transition-colors">
            Tutor Sign Up 🚀
          </Link>
        </div>
      </header>

      {/* Main Content Vertically Stacked */}
      <main className="max-w-5xl mx-auto px-6 py-12 sm:py-16 space-y-16 flex-1 w-full">
        
        {/* 1. TOP HERO PANEL (Auto-looping with locked container height to eliminate shifting) */}
        <div className="text-center space-y-6 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-red-50 border border-red-100 text-[#B3191F] px-3.5 py-1.5 rounded-full text-xs font-extrabold tracking-wide uppercase shadow-2xs">
            {hero.tag}
          </div>

          <div className="min-h-[160px] sm:min-h-[140px] flex flex-col justify-center space-y-3">
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
              {hero.titlePrefix}<span className="text-[#B3191F]">{hero.highlight}</span>
            </h1>
            <p className="text-sm sm:text-base text-gray-600 font-medium leading-relaxed max-w-2xl mx-auto">
              {hero.description}
            </p>
          </div>

          {/* Dual Action CTAs */}
          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
            <Link href="/parent/dashboard" className="px-6 py-3.5 bg-gray-900 hover:bg-black text-white text-xs font-extrabold rounded-2xl shadow-sm text-center transition-all flex items-center justify-center gap-2">
              👨‍👩‍👧‍👦 Browse Verified Tutors Instantly ➔
            </Link>
            <Link href="/tutor/register" className="px-6 py-3.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-extrabold rounded-2xl shadow-sm text-center transition-all flex items-center justify-center gap-2">
              🚀 Register as a Tutor (Fast Sign Up)
            </Link>
          </div>
        </div>

        {/* 2. MIDDLE SECTION: 3-Tabbed "How Trust is Verified" Box with Learn More routing to Support */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6 max-w-3xl mx-auto w-full">
          <div className="text-center space-y-1">
            <h3 className="text-sm font-black uppercase text-gray-400 tracking-wider">How Trust is Verified</h3>
            <p className="text-xs text-gray-500">Explore our rigorous compliance and safety measures</p>
          </div>
          
          {/* Interactive Tab Selectors */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-bold">
            <button onClick={() => setActiveTab("verification")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "verification" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>🎥 Video & Degrees</button>
            <button onClick={() => setActiveTab("safety")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "safety" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>🛡️ Parent Safety</button>
            <button onClick={() => setActiveTab("matching")} className={`flex-1 py-2 rounded-lg transition-all ${activeTab === "matching" ? "bg-white text-black shadow-xs" : "text-gray-500"}`}>⚡ Quick Match</button>
          </div>

          {/* Dynamic Content Card with Learn More Link */}
          <div className="p-5 bg-gray-50 rounded-2xl text-xs leading-relaxed space-y-3 border border-gray-100 flex flex-col justify-between min-h-[130px]">
            {activeTab === "verification" && (
              <>
                <div>
                  <strong className="text-gray-900 text-sm block mb-1">60-Second On-Camera Verification</strong>
                  <p className="text-gray-600">Every tutor must hold their physical degree on camera and speak live during registration. Our admins manually audit every file before approval.</p>
                </div>
                <div className="text-right">
                  <Link href="/faq" className="text-[#B3191F] font-extrabold hover:underline inline-flex items-center gap-1">Learn More ➔</Link>
                </div>
              </>
            )}
            {activeTab === "safety" && (
              <>
                <div>
                  <strong className="text-gray-900 text-sm block mb-1">Peace of Mind for Pakistani Families</strong>
                  <p className="text-gray-600">Never let unvetted strangers into your home. Know exactly who is teaching your child with complete location and ID tracking.</p>
                </div>
                <div className="text-right">
                  <Link href="/faq" className="text-[#B3191F] font-extrabold hover:underline inline-flex items-center gap-1">Learn More ➔</Link>
                </div>
              </>
            )}
            {activeTab === "matching" && (
              <>
                <div>
                  <strong className="text-gray-900 text-sm block mb-1">Direct Connect & Job Posting</strong>
                  <p className="text-gray-600">Browse tutors instantly by city or post a personalized job requirement to have matching educators contact you within minutes.</p>
                </div>
                <div className="text-right">
                  <Link href="/faq" className="text-[#B3191F] font-extrabold hover:underline inline-flex items-center gap-1">Learn More ➔</Link>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3. BOTTOM SECTION: 3 Separate Trust Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-gray-200">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1 shadow-2xs">
            <div className="text-xl font-black text-[#B3191F]">100%</div>
            <div className="text-xs font-bold text-gray-900">Camera-Verified Degrees</div>
            <p className="text-xs text-gray-500">No forged certificates or unvetted profiles.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1 shadow-2xs">
            <div className="text-xl font-black text-gray-900">Lahore & Beyond</div>
            <div className="text-xs font-bold text-gray-900">Active Across Major Cities</div>
            <p className="text-xs text-gray-500">Multan, Karachi, Islamabad, and Lahore.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-1 shadow-2xs">
            <div className="text-xl font-black text-emerald-600">10 Min Response</div>
            <div className="text-xs font-bold text-gray-900">Fast WhatsApp Coordination</div>
            <p className="text-xs text-gray-500">Connect with educators instantly.</p>
          </div>
        </div>
      </main>

      {/* FLOATING CHATBOT WIDGET AT BOTTOM RIGHT */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen ? (
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-80 sm:w-96 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Chat Header */}
            <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse"></span>
                <div>
                  <h4 className="text-xs font-black">TutorMint Assistant</h4>
                  <p className="text-[10px] text-gray-400">Ask anything about verified tutors</p>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white font-bold text-sm px-2">✕</button>
            </div>

            {/* Chat Body / Messages */}
            <div className="p-4 h-80 overflow-y-auto space-y-3 bg-gray-50 text-xs flex flex-col">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`p-3 rounded-2xl max-w-[80%] leading-relaxed ${m.sender === "user" ? "bg-[#B3191F] text-white rounded-br-none" : "bg-white text-gray-800 border border-gray-200 rounded-bl-none shadow-2xs"}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input Form */}
            <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-gray-100 flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your question here..."
                className="flex-1 p-2.5 bg-gray-100 rounded-xl text-xs border border-transparent focus:border-gray-300 focus:bg-white outline-none"
              />
              <button type="submit" className="px-4 py-2.5 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl transition-colors">
                Send ➔
              </button>
            </form>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-[#B3191F] hover:bg-[#9a151b] text-white p-4 rounded-full shadow-2xl flex items-center gap-2 font-extrabold text-xs transition-all hover:scale-105 group relative"
          >
            <span className="text-lg">💬</span>
            <span className="hidden sm:inline pr-1">Need Help? Chat with Us</span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping"></span>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full"></span>
          </button>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-5xl mx-auto w-full gap-4">
        <div>© 2026 TutorMint. All rights reserved. Verified Education Platform.</div>
        <div className="flex space-x-6 text-[11px]">
          <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
          <Link href="/faq" className="hover:text-gray-600">FAQs</Link>
          <Link href="/faq" className="hover:text-gray-600">Support</Link>
          <Link href="/about" className="hover:text-gray-600">About</Link>
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
        </div>
      </footer>
    </div>
  );
}