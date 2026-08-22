'use client'

import { useState, useEffect, use, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ChatRoomPage({ params }: { params: Promise<{ jobId: string }> }) {
  const resolvedParams = use(params)
  const jobId = resolvedParams.jobId

  const [job, setJob] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [awarding, setAwarding] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchJobAndMessages()

    // Setup Supabase Realtime Listener for instant message sync
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
            // Prevent duplicate entries if already added optimistically
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
    } catch (err: any) {
      console.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    const messageText = newMessage.trim()
    setNewMessage('') // Clear input immediately for snappy UX

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { error } = await supabase.from('job_messages').insert({
        job_tx_id: jobId,
        sender_id: user.id,
        message: messageText,
      })

      if (error) throw error
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleAwardJob = async (tutorUserId: string, tutorName: string) => {
    if (!confirm(`Are you sure you want to award this job to ${tutorName}? This will close the listing and lock their time slot.`)) return
    setAwarding(true)

    try {
      const res = await fetch('/api/parent/jobs/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTxId: jobId, awardedTutorId: tutorUserId }),
      })

      if (!res.ok) throw new Error('Failed to close and award job')

      alert('Job successfully awarded! Time slot locked and stakeholder tutors notified.')
      router.push('/parent/dashboard')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setAwarding(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm font-bold text-slate-900">Loading secure conversation...</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6 my-10 space-y-6">
      {/* Sticky Transaction Header */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-400 text-slate-900 text-[10px] font-mono font-bold rounded-full uppercase">
              Sticky Tx ID: {jobId}
            </span>
            <span className="text-xs text-emerald-400 font-bold uppercase">{job?.status}</span>
          </div>
          <h1 className="text-xl font-black mt-2">{job?.title}</h1>
          <p className="text-xs text-slate-300">{job?.subject} • {job?.grade} • Budget: {job?.budget}</p>
        </div>

        {job?.status === 'active' && (
          <button
            onClick={() => handleAwardJob('tutor-user-id-placeholder', 'Assigned Tutor')}
            disabled={awarding}
            className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md disabled:opacity-50"
          >
            {awarding ? 'Processing...' : 'Award Job & Lock Slot'}
          </button>
        )}
      </div>

      {/* Chat Messages Box */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 h-[450px] flex flex-col justify-between shadow-sm">
        <div className="overflow-y-auto space-y-4 pr-2 flex-1">
          {messages.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-20">
              No messages yet. Start discussing your demo class details below!
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={msg.id || idx} className="p-3 bg-gray-50 border border-gray-100 rounded-xl max-w-lg space-y-1">
                <p className="text-xs text-slate-900">{msg.message}</p>
                <span className="text-[10px] text-gray-400 block">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Form */}
        <form onSubmit={handleSendMessage} className="flex gap-3 pt-4 border-t border-gray-100 mt-4">
          <input
            type="text"
            placeholder="Type your message regarding demo classes or timings..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 text-slate-900"
          />
          <button
            type="submit"
            className="px-6 py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}