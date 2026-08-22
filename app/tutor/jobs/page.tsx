'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function TutorJobsPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchRequests()
  }, [])

  const fetchRequests = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('tutor_applications')
        .select('*, parent_jobs(*)')
        .eq('tutor_user_id', user.id)

      if (error) throw error
      setRequests(data || [])
    } catch (err: any) {
      console.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResponse = async (applicationId: string, status: 'accepted' | 'rejected', jobTxId: string) => {
    try {
      const res = await fetch('/api/tutor/apply', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, status, jobTxId })
      })

      if (!res.ok) throw new Error('Failed to update status')

      alert(`Request ${status} successfully!`)
      if (status === 'accepted') {
        router.push(`/chat/${jobTxId}`)
      } else {
        fetchRequests()
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm font-bold">Loading requests...</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 my-10">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Incoming Tuition & Demo Requests</h1>
        <p className="text-xs text-gray-500">Manage direct parent inquiries and bound transaction IDs.</p>
      </div>

      <div className="space-y-4">
        {requests.length === 0 ? (
          <div className="p-8 bg-white border border-gray-200 rounded-2xl text-center text-xs text-gray-500">
            No active tuition requests at the moment. Keep your profile 100% complete to receive matches!
          </div>
        ) : (
          requests.map((req) => (
            <div key={req.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className="px-3 py-1 bg-slate-100 text-slate-800 text-[10px] font-mono font-bold rounded-full uppercase">
                    {req.parent_jobs?.job_tx_id}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 mt-2">{req.parent_jobs?.title}</h2>
                  <p className="text-xs text-gray-500">{req.parent_jobs?.subject} • {req.parent_jobs?.grade} • {req.parent_jobs?.location}</p>
                </div>
                <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase ${
                  req.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' :
                  req.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {req.status}
                </span>
              </div>

              <p className="text-xs text-slate-700 bg-gray-50 p-3 rounded-xl">
                {req.parent_jobs?.description}
              </p>

              {req.status === 'pending' && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => handleResponse(req.id, 'accepted', req.parent_jobs?.job_tx_id)}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md"
                  >
                    Accept Request & Open Chat
                  </button>
                  <button
                    onClick={() => handleResponse(req.id, 'rejected', req.parent_jobs?.job_tx_id)}
                    className="px-6 py-3 bg-gray-100 hover:bg-red-50 hover:text-red-700 text-slate-700 font-bold text-xs uppercase rounded-xl transition-all"
                  >
                    Reject
                  </button>
                </div>
              )}

              {req.status === 'accepted' && (
                <div className="pt-2">
                  <Link
                    href={`/chat/${req.parent_jobs?.job_tx_id}`}
                    className="block text-center py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs uppercase rounded-xl transition-all"
                  >
                    Go to Sticky Transaction Chat
                  </Link>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}