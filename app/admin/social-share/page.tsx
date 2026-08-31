'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const verifiedTutorsList = [
  {
    id: 1,
    name: "Ayesha Khan",
    title: "Expert in Mathematics (Grade 9 & 10)",
    description: "BS Mathematics from LUMS with 5+ years of O/A Level and Matric coaching experience. Focused on conceptual clarity and past papers.",
    profileUrl: "https://www.tutormint.org/tutor/ayesha-khan",
    imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300"
  },
  {
    id: 2,
    name: "Muhammad Ali",
    title: "Expert in Physics & Sciences (FSc)",
    description: "BS Computer Science from PU. Passionate about making physics intuitive and high-scoring for FSc and Matric students in Lahore.",
    profileUrl: "https://www.tutormint.org/tutor/muhammad-ali",
    imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300"
  }
];

export default function AdminSocialSharePage() {
  const [selectedTutor, setSelectedTutor] = useState(verifiedTutorsList[0]);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const router = useRouter()
  const supabase = createClient()

  // Access is enforced server-side by app/admin/layout.tsx, which requires
  // profiles.role = 'admin'. The old check compared user.email against a
  // hardcoded address in the browser bundle, which gated nothing on the server.
  useEffect(() => {
    setIsAdmin(true);
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm font-bold text-slate-900">Verifying admin credentials...</div>;
  }

  // If not admin, display strict Access Denied screen
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="bg-white p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-gray-200">
          <span className="text-4xl">🔒</span>
          <h1 className="text-xl font-black text-slate-900">Access Restricted</h1>
          <p className="text-xs text-gray-500 leading-relaxed">
            This is a secure admin-only area. Regular users and parents do not have permission to view or generate social media posts.
          </p>
          <button
            onClick={() => router.push('/parent/dashboard')}
            className="w-full py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
          >
            Return to Dashboard ➔
          </button>
        </div>
      </div>
    );
  }

  const hashtags = "#TutorMint #VerifiedTutor #HomeTutorPakistan #EducationGrowth #DirectTutors";
  
  const fullShareText = `🌟 *Verified Tutor Spotlight* 🌟\n\n` +
    `👤 *Name:* ${selectedTutor.name}\n` +
    `🎯 *Title:* ${selectedTutor.title}\n` +
    `📝 *About:* ${selectedTutor.description}\n\n` +
    `🌐 *Profile Link:* ${selectedTutor.profileUrl}\n\n` +
    `${hashtags}`;

  const handleCopyPost = () => {
    navigator.clipboard.writeText(fullShareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 my-10 space-y-8 font-sans">
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black text-slate-900">Admin Social Media Post Generator</h1>
            <p className="text-xs text-gray-500 mt-1">Select any verified tutor to instantly generate brand-themed promotional posts for social media.</p>
          </div>
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full uppercase">
            Admin Verified
          </span>
        </div>
        
        <div className="mt-4 flex gap-3">
          {verifiedTutorsList.map((tutor) => (
            <button
              key={tutor.id}
              onClick={() => setSelectedTutor(tutor)}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${selectedTutor.id === tutor.id ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {tutor.name}
            </button>
          ))}
        </div>
      </div>

      {/* Brand Theme Post Template Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-slate-900 to-[#1f1f7a] text-white p-8 rounded-3xl shadow-xl border border-emerald-400/30 flex flex-col justify-between space-y-6">
          <div className="flex items-center gap-4">
            <img src={selectedTutor.imageUrl} alt={selectedTutor.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-400 shadow-md" />
            <div>
              <span className="bg-emerald-400 text-slate-900 text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase">Verified TutorMint Expert</span>
              <h3 className="text-lg font-black mt-1">{selectedTutor.name}</h3>
              <p className="text-xs text-emerald-300 font-semibold">{selectedTutor.title}</p>
            </div>
          </div>
          
          <p className="text-xs text-slate-200 leading-relaxed bg-white/5 p-4 rounded-2xl border border-white/10">
            {selectedTutor.description}
          </p>

          <div className="flex justify-between items-center text-[10px] text-slate-400 border-t border-white/10 pt-3">
            <span>🌐 www.tutormint.org</span>
            <span className="text-emerald-400 font-bold">{hashtags}</span>
          </div>
        </div>

        {/* Copy & Share Control Panel */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 mb-2">Generated Post Content</h3>
            <textarea
              readOnly
              value={fullShareText}
              rows={8}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-mono text-slate-800 outline-none resize-none"
            />
          </div>

          <div className="space-y-3">
            <button
              onClick={handleCopyPost}
              className="w-full py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
            >
              {copied ? '✅ Copied to Clipboard!' : '📋 Copy Post & Hashtags'}
            </button>
            <a
              href={`https://api.whatsapp.com/send?text=${encodeURIComponent(fullShareText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
            >
              Share Directly to WhatsApp 💬
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}