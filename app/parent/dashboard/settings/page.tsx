'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const cityAreasMap: Record<string, string[]> = {
  Lahore: ["Gulberg", "DHA", "Johar Town", "Model Town", "Bahria Town"],
  Karachi: ["Clifton", "DHA", "Gulshan-e-Iqbal", "North Nazimabad"],
  Islamabad: ["F-6", "F-7", "G-8", "Bahria Town"],
  Multan: ["Cantt", "Shah Rukn-e-Alam", "Bosan Road"]
};

export default function ParentSettingsPage() {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('Lahore')
  const [area, setArea] = useState('Gulberg')
  const [avatarUrl, setAvatarUrl] = useState('')
  
  const [children, setChildren] = useState<{ name: string; grade: string; subjects: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchParentProfile()
  }, [])

  const fetchParentProfile = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        router.replace('/login')
        return
      }

      const { data: profile } = await supabase
        .from('parent_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profile) {
        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
        setCity(profile.city || 'Lahore')
        setArea(profile.area || 'Gulberg')
        setAvatarUrl(profile.avatar_url || '')
        setChildren(profile.children || [])
      }
    } catch (err: any) {
      console.error("Error fetching profile:", err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setAvatarUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleAddChild = () => {
    setChildren([...children, { name: '', grade: '', subjects: '' }])
  }

  const handleChildChange = (index: number, field: string, value: string) => {
    const updated = [...children]
    updated[index] = { ...updated[index], [field]: value }
    setChildren(updated)
  }

  const handleRemoveChild = (index: number) => {
    setChildren(children.filter((_, i) => i !== index))
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage({ type: '', text: '' })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const updates = {
        id: user.id,
        full_name: fullName,
        phone,
        city,
        area,
        avatar_url: avatarUrl,
        children: children,
        updated_at: new Date(),
      }

      const { error } = await supabase
        .from('parent_profiles')
        .upsert(updates)

      if (error) throw error

      setMessage({ type: 'success', text: '✅ Profile and children details saved successfully!' })
    } catch (err: any) {
      setMessage({ type: 'error', text: `❌ Error: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Loading settings...
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 sm:px-6 lg:px-8 text-[#334155]">
      <div className="max-w-3xl mx-auto space-y-8">
        
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-200 flex justify-between items-center">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#0F172A]">Parent Account Settings</h1>
            <p className="text-xs text-gray-500">Manage your contact details and register children needing tutors.</p>
          </div>
          <Link 
            href="/parent/dashboard" 
            className="px-4 py-2.5 bg-[#F8FAFC] hover:bg-gray-200 text-[#334155] text-xs font-bold rounded-xl border border-gray-200 transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <form onSubmit={handleSaveSettings} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200 space-y-8">
          
          {message.text && (
            <div className={`p-4 rounded-2xl text-xs font-bold text-center ${
              message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-[#d60008] border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-3">
              Personal Information
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#0F172A]">Full Name</label>
                <input 
                  type="text" 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Muhammad Ali"
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-[#0F172A]">Phone Number</label>
                <input 
                  type="text" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0300 1234567"
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
                />
              </div>
            </div>

            {/* Direct Profile Picture File Upload */}
            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-[#0F172A]">Profile Picture</label>
              <div className="flex items-center gap-4">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar Preview" className="w-14 h-14 rounded-2xl object-cover border border-gray-200 shadow-sm" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center text-xs text-gray-400 font-bold">
                    No Img
                  </div>
                )}
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#0F172A] file:text-white hover:file:bg-black text-xs text-gray-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Location Preferences */}
          <div className="space-y-4 pt-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-3">
              Location Preferences
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#0F172A]">City</label>
                <select 
                  value={city}
                  onChange={(e) => {
                    const newCity = e.target.value
                    setCity(newCity)
                    const areas = cityAreasMap[newCity] || ['Gulberg']
                    setArea(areas[0])
                  }}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
                >
                  {Object.keys(cityAreasMap).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-[#0F172A]">Area / Neighborhood</label>
                <select 
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
                >
                  {(cityAreasMap[city] || ['Gulberg']).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* CHILDREN / STUDENTS SECTION */}
          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
                👶 My Children / Students ({children.length})
              </h3>
              <button
                type="button"
                onClick={handleAddChild}
                className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-[#059669] text-xs font-bold rounded-xl transition-all"
              >
                + Add Child
              </button>
            </div>

            {children.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-2">No children added yet. Click "+ Add Child" to specify student details.</p>
            ) : (
              <div className="space-y-4">
                {children.map((child, index) => (
                  <div key={index} className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl space-y-3 relative">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono font-bold text-gray-500 uppercase">Child #{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveChild(index)}
                        className="text-xs font-bold text-[#d60008] hover:underline"
                      >
                        Remove ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#0F172A]">Child's Name / Nickname</label>
                        <input 
                          type="text"
                          value={child.name}
                          onChange={(e) => handleChildChange(index, 'name', e.target.value)}
                          placeholder="e.g. Ali"
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs outline-none text-[#334155]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#0F172A]">Grade / Level</label>
                        <input 
                          type="text"
                          value={child.grade}
                          onChange={(e) => handleChildChange(index, 'grade', e.target.value)}
                          placeholder="e.g. Grade 9 / O-Levels"
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs outline-none text-[#334155]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#0F172A]">Target Subjects</label>
                        <input 
                          type="text"
                          value={child.subjects}
                          onChange={(e) => handleChildChange(index, 'subjects', e.target.value)}
                          placeholder="e.g. Mathematics, Physics"
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs outline-none text-[#334155]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
            >
              {saving ? 'Saving Changes...' : 'Save Profile & Children ➔'}
            </button>
          </div>

        </form>

      </div>
    </main>
  )
}