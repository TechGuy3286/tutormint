'use client'

import { useState } from 'react'
import Link from 'next/link'

// Sample mock data for verified tutors matching TutorMint standards
const sampleTutors = [
  {
    id: 'TM-8821',
    name: 'Sir Bilal Ahmed',
    title: 'Expert O/A Level Mathematics & Physics',
    area: 'DHA Phase 5, Lahore',
    subjects: ['Mathematics', 'Physics'],
    demoRating: '4.9 ★',
    methodRating: '4.8 ★',
    rate: 'Rs. 25,000 / month',
    verified: true,
  },
  {
    id: 'TM-9104',
    name: 'Ms. Ayesha Khan',
    title: 'Primary & Middle School All-Subjects Specialist',
    area: 'Gulberg III, Lahore',
    subjects: ['English', 'Science', 'Urdu'],
    demoRating: '5.0 ★',
    methodRating: '4.9 ★',
    rate: 'Rs. 20,000 / month',
    verified: true,
  },
  {
    id: 'TM-7342',
    name: 'Sir Zeeshan Haider',
    title: 'Computer Science & Programming Tutor',
    area: 'Model Town, Lahore',
    subjects: ['Computer Science', 'Python', 'Math'],
    demoRating: '4.7 ★',
    methodRating: '4.8 ★',
    rate: 'Rs. 30,000 / month',
    verified: true,
  },
]

export default function ParentBrowsePage() {
  const [searchSubject, setSearchSubject] = useState('')
  const [selectedArea, setSelectedArea] = useState('All')

  const filteredTutors = sampleTutors.filter(tutor => {
    const matchesSubject = tutor.subjects.some(s => s.toLowerCase().includes(searchSubject.toLowerCase())) ||
                           tutor.name.toLowerCase().includes(searchSubject.toLowerCase())
    const matchesArea = selectedArea === 'All' || tutor.area.includes(selectedArea)
    return matchesSubject && matchesArea
  })

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header & Ad Posting Banner */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Find Verified Tutors</h1>
            <p className="text-sm text-gray-500 mt-1">
              Browse directly through verified tutors in your neighborhood. No middlemen, direct peer-to-peer connection.
            </p>
          </div>
          <div className="w-full md:w-auto text-center">
            <Link 
              href="/parent/post-job" 
              className="inline-block px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow-md transition-all"
            >
              Didn't Find a Match? Post an Ad
            </Link>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Search Subject or Tutor Name</label>
            <input
              type="text"
              value={searchSubject}
              onChange={(e) => setSearchSubject(e.target.value)}
              placeholder="e.g. Mathematics, Bilal..."
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Filter by Area (Lahore)</label>
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            >
              <option value="All">All Areas</option>
              <option value="DHA">DHA</option>
              <option value="Gulberg">Gulberg</option>
              <option value="Model Town">Model Town</option>
            </select>
          </div>
        </div>

        {/* Tutor Directory Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filteredTutors.length > 0 ? (
            filteredTutors.map((tutor) => (
              <div key={tutor.id} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 flex flex-col justify-between space-y-4 hover:border-emerald-500 transition-all">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold text-slate-400">{tutor.id}</span>
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-200">
                      Verified Tutor ✓
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{tutor.name}</h3>
                  <p className="text-xs font-medium text-slate-600 mt-0.5">{tutor.title}</p>
                  <p className="text-xs text-gray-400 mt-1">📍 {tutor.area}</p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {tutor.subjects.map(sub => (
                      <span key={sub} className="px-2.5 py-1 bg-gray-100 text-slate-700 text-xs font-medium rounded-lg">
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 space-y-3">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span>Demo: <strong className="text-emerald-600">{tutor.demoRating}</strong></span>
                    <span>Method: <strong className="text-slate-900">{tutor.methodRating}</strong></span>
                  </div>
                  <div className="text-sm font-bold text-slate-900">{tutor.rate}</div>
                  
                  <button 
                    onClick={() => alert(`Demo request sent to ${tutor.name}. Awaiting acceptance.`)}
                    className="w-full py-3 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow transition-all"
                  >
                    Request Free Demo Class
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-3 text-center py-12 bg-white rounded-2xl border border-gray-200">
              <p className="text-gray-500 text-sm">No tutors match your specific filter.</p>
              <Link href="/parent/post-job" className="mt-3 inline-block text-emerald-600 font-bold text-xs uppercase tracking-wider underline">
                Post a Job Ad instead →
              </Link>
            </div>
          )}
        </div>

      </div>
    </main>
  )
}