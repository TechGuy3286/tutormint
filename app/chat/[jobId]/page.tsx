'use client'

import { useState, useEffect, use, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const allAvailableTutors = [
  {
    id: 1,
    name: "Ayesha Khan",
    city: "Lahore",
    area: "Gulberg",
    subject: "Mathematics",
    grade: "Grade 9 & 10 - Science",
    rating: 4.9,
    reviewCount: 24,
    degree: "BS Mathematics (LUMS)",
    budget: "25,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
  },
  {
    id: 2,
    name: "Muhammad Ali",
    city: "Lahore",
    area: "DHA",
    subject: "Physics",
    grade: "FSC Part I & Part II",
    rating: 4.8,
    reviewCount: 19,
    degree: "BS Computer Science (PU)",
    budget: "30,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150"
  },
  {
    id: 3,
    name: "Alee Sabeer",
    city: "Karachi",
    area: "Clifton",
    subject: "Computer Science",
    grade: "O Levels",
    rating: 5.0,
    reviewCount: 32,
    degree: "BS Software Engineering",
    budget: "35,000 PKR / mo",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150"
  }
];

export default function ChatRoomPage({ params }: { params: Promise<{ jobId: string }> }) {
  const resolvedParams = use(params)
  const jobId = resolvedParams.jobId

  const [job, setJob] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [awarding, setAwarding] = useState(false)
  const [tutorId, setTutorId] = useState<string | null>(null)
  
  const [modalNotification, setModalNotification] = useState<{ title: string; message: string } | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchJobAndMessages()

    const channel = supabase
      .channel(`job-chat-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'job_messages',
          filter: `job_tx_id=eq.${jobId}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchJobAndMessages = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const { data: jobData, error: jobError } = await supabase
        .from('parent_jobs')
        .select('*')
        .eq('job_tx_id', jobId)
        .single()

      if (jobError) throw jobError
      setJob(jobData)

      const { data: msgData, error: msgError } = await supabase
        .from('job_messages')
        .select('*')
        .eq('job_tx_id', jobId)
        .order('created_at', { ascending: true })

      if (msgError) throw msgError
      setMessages(msgData || [])

      if (msgData && user) {
        const foundTutorMsg = msgData.find((m: any) => m.sender_id !== user.id)
        if (foundTutorMsg) {
          setTutorId(foundTutorMsg.sender_id)
        }
      }
    } catch (err: any) {
      console.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (e: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault()
    const textToSend = customText || newMessage.trim()
    if (!textToSend) return

    if (!customText) setNewMessage('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { error } = await supabase.from('job_messages').insert({
        job_tx_id: jobId,
        sender_id: user.id,
        message: textToSend,
      })

      if (error) throw error
    } catch (err: any) {
      setModalNotification({
        title: "Action Error",
        message: err.message
      })
    }
  }

  const handleSendDemoClassRequest = async (tutorName: string) => {
    if (job?.status === 'Pending Tutor Acceptance' || job?.status === 'Accepted by Tutor' || job?.status === 'Awarded') {
      setModalNotification({
        title: "Demo Request Already Sent! ⚠️",
        message: "A Demo Class Request has already been dispatched for this job requirement. Please wait for the tutor to accept or respond."
      })
      return
    }

    const demoMessage = `📅 Demo Class Request sent to ${tutorName} for requirement [${job?.job_tx_id}]: "${job?.title}". Please confirm your available time slot!`
    
    await supabase
      .from('parent_jobs')
      .update({ status: 'Pending Tutor Acceptance' })
      .eq('job_tx_id', jobId)

    setJob((prev: any) => ({ ...prev, status: 'Pending Tutor Acceptance' }))
    handleSendMessage({ preventDefault: () => {} } as any, demoMessage)
    
    setModalNotification({
      title: "Demo Class Request Dispatched! 🚀",
      message: `Your trial invitation has been sent to ${tutorName}. The chat room will fully unlock once the tutor accepts your request.`
    })
  }

  const handleAwardJob = async () => {
    if (!confirm('Are you sure you want to award this job? This will close the listing and lock their time slot.')) return
    setAwarding(true)

    try {
      const res = await fetch('/api/parent/jobs/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTxId: jobId, awardedTutorId: tutorId || 'system' }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to close and award job')

      setModalNotification({
        title: "Job Successfully Awarded! 🎉",
        message: "The time slot has been securely locked and stakeholder tutors have been notified."
      })
      
      setTimeout(() => {
        router.push('/parent/dashboard')
      }, 2000)
    } catch (err: any) {
      setModalNotification({
        title: "Error",
        message: err.message
      })
    } finally {
      setAwarding(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm font-bold text-[#0F172A]">Loading secure conversation...</div>
  }

  const matchedTutors = allAvailableTutors.filter(t => !job?.city || t.city.toLowerCase() === job.city.toLowerCase());
  const isChatUnlocked = job?.status === 'Accepted by Tutor' || job?.status === 'Awarded';
  const isRequestAlreadySent = job?.status === 'Pending Tutor Acceptance' || job?.status === 'Accepted by Tutor' || job?.status === 'Awarded';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 my-8 space-y-6 font-sans text-[#334155]">
      
      {/* Sticky Transaction Header */}
      <div className="bg-[#0F172A] text-white p-6 rounded-3xl shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-400 text-[#0F172A] text-[10px] font-mono font-bold rounded-full uppercase">
              Sticky Tx ID: {jobId}
            </span>
            <span className="text-xs text-emerald-400 font-bold uppercase">Status: {job?.status || 'Active'}</span>
          </div>
          <h1 className="text-xl font-black mt-2 text-white">{job?.title}</h1>
          <p className="text-xs text-slate-300 mt-1">📍 {job?.area}, {job?.city} • 📚 {job?.subject} • 💵 {job?.budget}</p>
        </div>

        {isChatUnlocked && job?.status !== 'Awarded' && (
          <button
            onClick={handleAwardJob}
            disabled={awarding}
            className="px-5 py-3 bg-[#059669] hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md disabled:opacity-50 whitespace-nowrap"
          >
            {awarding ? 'Processing...' : 'Award Job & Lock Slot'}
          </button>
        )}
      </div>

      {/* AI-Matched Tutors Panel for this Job */}
      <div className="bg-white border border-gray-200 p-6 rounded-3xl shadow-sm space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">
          AI-Matched Tutors for this Requirement ({matchedTutors.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {matchedTutors.map((tutor) => (
            <div key={tutor.id} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src={tutor.image} alt={tutor.name} className="w-12 h-12 rounded-xl object-cover border" />
                <div>
                  <h4 className="text-xs font-black text-[#0F172A]">{tutor.name}</h4>
                  <p className="text-[10px] text-[#059669] font-bold">⭐ {tutor.rating} ({tutor.reviewCount}) • {tutor.subject}</p>
                  <p className="text-[10px] text-gray-500">{tutor.degree}</p>
                </div>
              </div>
              <button
                onClick={() => handleSendDemoClassRequest(tutor.name)}
                className={`px-4 py-2.5 text-[11px] font-extrabold rounded-xl transition-all shadow-sm whitespace-nowrap ${
                  isRequestAlreadySent 
                    ? 'bg-amber-100 text-amber-800 cursor-pointer' 
                    : 'bg-[#d60008] hover:bg-red-700 text-white'
                }`}
              >
                {isRequestAlreadySent ? '⏳ Request Sent' : '📅 Send Demo Class'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Room Area (Locked until Tutor Accepts) */}
      <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
        {!isChatUnlocked ? (
          <div className="py-16 text-center space-y-3">
            <span className="text-3xl">🔒</span>
            <h3 className="text-sm font-black text-[#0F172A] uppercase">Chat Room Locked</h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
              To preserve our direct 2-party handshake model, personalized messaging unlocks only after the tutor explicitly accepts your Demo Class request above.
            </p>
          </div>
        ) : (
          <div className="h-[400px] flex flex-col justify-between">
            <div className="overflow-y-auto space-y-3 pr-2 flex-1">
              {messages.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-16">
                  Chat unlocked! Start discussing schedule and demo class details below.
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={msg.id || idx} className="p-3 bg-[#F8FAFC] border border-gray-100 rounded-2xl max-w-lg space-y-1">
                    <p className="text-xs text-[#334155] font-medium">{msg.message}</p>
                    <span className="text-[10px] text-gray-400 block">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input Form */}
            <form onSubmit={(e) => handleSendMessage(e)} className="flex gap-3 pt-4 border-t border-gray-100 mt-4">
              <input
                type="text"
                placeholder="Type your message regarding demo classes or timings..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 px-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-[#059669] text-[#334155]"
              />
              <button
                type="submit"
                className="px-6 py-3 bg-[#0F172A] hover:bg-[#059669] text-white font-bold text-xs uppercase rounded-xl transition-all"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Brand-Consistent Acknowledgement Modal Popup */}
      {modalNotification && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full space-y-6 shadow-2xl animate-in fade-in zoom-in-95 text-center">
            <div className="space-y-2">
              <span className="text-3xl">✨</span>
              <h3 className="text-lg font-black text-[#0F172A]">{modalNotification.title}</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                {modalNotification.message}
              </p>
            </div>
            <button
              onClick={() => setModalNotification(null)}
              className="w-full py-3 bg-[#0F172A] hover:bg-[#059669] text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
            >
              Got It, Continue ➔
            </button>
          </div>
        </div>
      )}

    </div>
  )
}