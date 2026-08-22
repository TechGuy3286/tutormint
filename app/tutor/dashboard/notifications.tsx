'use client'

import { useState, useEffect } from 'react'

export default function TutorNotificationsWidget() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/tutor/activity')
      .then(res => res.json())
      .then(data => {
        if (data.notifications) {
          setNotifications(data.notifications)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 my-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Activity & Curiosity Alerts</h3>
        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full">Live Feed</span>
      </div>

      <div className="space-y-3">
        {notifications.map((note, idx) => (
          <div key={note.id || idx} className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl flex items-start gap-3">
            <span className="text-emerald-600 text-base mt-0.5">🔔</span>
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-900">{note.message}</p>
              <span className="text-[10px] text-gray-400 block">{new Date(note.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}