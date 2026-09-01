'use client'

import { useState } from 'react'

export default function CancellationModal({ jobTxId, scheduledTime, onClose }: { jobTxId: string, scheduledTime: string, onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirm('Are you sure you want to cancel this demo class? Late cancellations (< 2 hours) will incur automated penalties.')) return

    setLoading(true)
    try {
      const res = await fetch('/api/demo/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTxId, scheduledTime, reason })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      alert(data.message)
      onClose()
      window.location.reload()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white max-w-md w-full p-6 rounded-2xl shadow-xl space-y-4">
        <div className="space-y-1">
          <span className="px-2.5 py-1 bg-tm-tint-red text-tm-red text-[10px] font-bold uppercase rounded-full">
            Demo Cancellation Policy
          </span>
          <h2 className="text-lg font-bold text-slate-900">Cancel Demo Class</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Note: Cancellations made with less than 2 hours notice violate the platform policy and will trigger an automated penalty to protect participants' time.
          </p>
        </div>

        <form onSubmit={handleCancelSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason for Cancellation</label>
            <textarea
              required
              rows={3}
              placeholder="Briefly explain why you need to cancel..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-tm-green-deep"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold text-xs uppercase rounded-xl transition-all"
            >
              Keep Demo
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Confirm Cancellation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}