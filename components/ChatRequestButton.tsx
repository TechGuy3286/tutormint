'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ChatRequestButton({ tutorId, parentId }: { tutorId: string, parentId: string }) {
  const [requestSent, setRequestSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleSendChatRequest = async () => {
    setLoading(true)
    try {
      const { error } = await supabase.from('chat_requests').insert({
        tutor_id: tutorId,
        parent_id: parentId,
        status: 'Pending'
      })

      if (error) throw error

      setRequestSent(true)
      alert('💬 Chat request sent successfully! The tutor must accept your request before the conversation opens.')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSendChatRequest}
      disabled={loading || requestSent}
      className={`px-5 py-3 text-xs font-extrabold rounded-xl transition-all shadow-sm ${
        requestSent 
          ? 'bg-emerald-100 text-emerald-800 cursor-not-allowed' 
          : 'bg-slate-900 hover:bg-emerald-600 text-white'
      }`}
    >
      {requestSent ? '✅ Request Pending Acceptance' : '💬 Send Direct Chat Request'}
    </button>
  )
}