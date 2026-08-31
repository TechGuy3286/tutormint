"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TutorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [tutorEmail, setTutorEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState("");

  // Change Password States
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [formData, setFormData] = useState({
    fullName: "Alishba Mam Tutor",
    phone_number: "0300-5671234",
    whatsapp_number: "923005671234",
    city: "Lahore",
    areaName: "DHA Phase 5",
    teachingModes: ["Physical"] as string[],
    profileImage: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    coverImageUrl: "",
    selfieUrl: "",
    cnicFrontUrl: "",
    cnicBackUrl: "",
    videoIntroUrl: ""
  });

  const [specialtyList, setSpecialtyList] = useState([
    { subject: "Mathematics", level: "Expert" },
    { subject: "Physics", level: "Advance" }
  ]);
  const [newSubjInput, setNewSubjInput] = useState("");
  const [newLevelInput, setNewLevelInput] = useState("Basic");

  // Availability & Timings
  const [availabilityList, setAvailabilityList] = useState([
    { day: "Monday", timeSlot: "04:00 PM - 07:00 PM" },
    { day: "Wednesday", timeSlot: "04:00 PM - 07:00 PM" }
  ]);
  const [newDayInput, setNewDayInput] = useState("Monday");
  const [newTimeInput, setNewTimeInput] = useState("");

  const [degrees, setDegrees] = useState([
    { title: "MS Mathematics", institute: "LUMS, Lahore", year: "2021", fileName: "degree_ms.pdf", fileUrl: "" }
  ]);
  const [newDegree, setNewDegree] = useState({ title: "", institute: "", year: "", fileName: "", fileUrl: "" });

  const [certifications, setCertifications] = useState([
    { title: "Cambridge Certified Educator", issuer: "CAIE", year: "2022", fileName: "cert_cambridge.pdf", fileUrl: "" }
  ]);
  const [newCert, setNewCert] = useState({ title: "", issuer: "", year: "", fileName: "", fileUrl: "" });

  useEffect(() => {
    loadTutorProfile();
  }, []);

  const loadTutorProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/tutor/login');
        return;
      }

      setUserId(user.id);
      setTutorEmail(user.email || "");

      const { data, error } = await supabase
        .from('tutor_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        let parsedModes = ["Physical"];
        if (data.teaching_mode) {
          if (Array.isArray(data.teaching_mode)) {
            parsedModes = data.teaching_mode;
          } else if (typeof data.teaching_mode === 'string') {
            parsedModes = data.teaching_mode.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }

        setFormData({
          fullName: data.full_name || "Alishba Mam Tutor",
          phone_number: data.phone_number || "",
          whatsapp_number: data.whatsapp_number || "",
          city: data.city || "Lahore",
          areaName: data.area_name || "DHA Phase 5",
          teachingModes: parsedModes,
          profileImage: data.avatar_url || formData.profileImage,
          coverImageUrl: data.cover_image_url || "",
          selfieUrl: data.selfie_url || "",
          cnicFrontUrl: data.cnic_front_url || "",
          cnicBackUrl: data.cnic_back_url || data.experience_letter_url || "",
          videoIntroUrl: data.video_intro_url || ""
        });
        if (data.specialty_list && Array.isArray(data.specialty_list)) {
          setSpecialtyList(data.specialty_list);
        } else if (data.specialty_subjects) {
          setSpecialtyList([{ subject: data.specialty_subjects, level: "Expert" }]);
        }
        if (data.availability_list && Array.isArray(data.availability_list)) {
          setAvailabilityList(data.availability_list);
        }
        if (data.degrees && data.degrees.length > 0) setDegrees(data.degrees);
        if (data.certifications && data.certifications.length > 0) setCertifications(data.certifications);
      }
    } catch (err) {
      console.error("Error loading tutor profile:", err);
    }
  };

  const uploadFileToCloud = async (file: File): Promise<string | null> => {
    try {
      if (!userId) {
        alert("User ID not loaded yet. Please wait a moment and try again.");
        return null;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('tutor-media')
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error("Storage upload error:", uploadError.message);
        alert(`Storage Upload Error: ${uploadError.message}`);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('tutor-media')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (err: any) {
      console.error("Error uploading file:", err);
      alert(`Upload Exception: ${err.message || err}`);
      return null;
    }
  };

  const handleProfileImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, profileImage: publicUrl }));
    }
    setUploading(false);
  };

  const handleCoverImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, coverImageUrl: publicUrl }));
    }
    setUploading(false);
  };

  const handleSelfieCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, selfieUrl: publicUrl }));
    }
    setUploading(false);
  };

  const handleFileUploadField = async (e: React.ChangeEvent<HTMLInputElement>, fieldKey: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, [fieldKey]: publicUrl }));
    }
    setUploading(false);
  };

  const handlePortfolioVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingVideo(true);
    setYoutubeStatus("Uploading portfolio video directly to YouTube...");

    const uploadData = new FormData();
    uploadData.append("video", file);
    uploadData.append("title", `${formData.fullName} Portfolio Video | TutorMint`);
    uploadData.append("description", `Verified portfolio video submitted via TutorMint.`);

    try {
      const res = await fetch("/api/tutor/upload-youtube", {
        method: "POST",
        body: uploadData,
      });

      const result = await res.json();
      if (result.success) {
        setFormData(prev => ({ ...prev, videoIntroUrl: result.videoUrl }));
        setYoutubeStatus("✅ Portfolio Video successfully uploaded to YouTube!");
      } else {
        setYoutubeStatus("❌ Upload Failed: " + result.error);
      }
    } catch (err: any) {
      setYoutubeStatus("❌ Error: " + err.message);
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleAddDegree = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    let fileUrl = "";
    if (file) {
      const uploaded = await uploadFileToCloud(file);
      if (uploaded) fileUrl = uploaded;
    }
    setNewDegree({ ...newDegree, fileName: file?.name || "", fileUrl });
  };

  const pushDegree = () => {
    if (!newDegree.title) return;
    setDegrees([...degrees, newDegree]);
    setNewDegree({ title: "", institute: "", year: "", fileName: "", fileUrl: "" });
  };

  const handleAddCert = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    let fileUrl = "";
    if (file) {
      const uploaded = await uploadFileToCloud(file);
      if (uploaded) fileUrl = uploaded;
    }
    setNewCert({ ...newCert, fileName: file?.name || "", fileUrl });
  };

  const pushCert = () => {
    if (!newCert.title) return;
    setCertifications([...certifications, newCert]);
    setNewCert({ title: "", issuer: "", year: "", fileName: "", fileUrl: "" });
  };

  const addSpecialtySubject = () => {
    if (!newSubjInput.trim()) return;
    setSpecialtyList([...specialtyList, { subject: newSubjInput.trim(), level: newLevelInput }]);
    setNewSubjInput("");
  };

  const addAvailabilitySlot = () => {
    if (!newTimeInput.trim()) return;
    setAvailabilityList([...availabilityList, { day: newDayInput, timeSlot: newTimeInput.trim() }]);
    setNewTimeInput("");
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMsg("❌ New passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg("❌ Password must be at least 6 characters.");
      return;
    }

    setPasswordLoading(true);
    setPasswordMsg("");

    try {
      // Re-authenticate or update password directly via Supabase Auth
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordMsg("✅ Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordMsg("❌ Error: " + (err.message || "Failed to update password"));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      alert("User session not found. Please log in.");
      return;
    }

    setUploading(true);
    try {
      const combinedSubjectsString = specialtyList.map(s => `${s.subject} (${s.level})`).join(", ");

      const payload = {
        id: userId,
        full_name: formData.fullName,
        email: tutorEmail,
        phone_number: formData.phone_number,
        whatsapp_number: formData.whatsapp_number,
        city: formData.city,
        area_name: formData.areaName,
        teaching_mode: formData.teachingModes.join(", "),
        specialty_subjects: combinedSubjectsString,
        specialty_list: specialtyList,
        availability_list: availabilityList,
        avatar_url: formData.profileImage,
        cover_image_url: formData.coverImageUrl,
        selfie_url: formData.selfieUrl,
        cnic_front_url: formData.cnicFrontUrl,
        cnic_back_url: formData.cnicBackUrl,
        experience_letter_url: formData.cnicBackUrl,
        video_intro_url: formData.videoIntroUrl,
        degrees: degrees,
        certifications: certifications,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('tutor_profiles')
        .upsert(payload);

      if (error) throw error;

      setSuccessMsg("✨ Settings saved successfully!");
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      console.error("Error saving profile:", err.message);
      alert(`Error saving: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-[#334155] font-sans">
      
      {/* BREADCRUMBS */}
      <nav className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-gray-500">
          <Link href="/tutor/dashboard" className="hover:text-[#0F172A] transition-colors">Tutor Dashboard</Link>
          <span className="text-gray-300">/</span>
          <span className="text-[#059669]">Settings</span>
        </div>
        <Link 
          href="/tutor/dashboard" 
          className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#0F172A] text-xs font-bold rounded-xl transition-all"
        >
          ← Back to Dashboard
        </Link>
      </nav>

      {/* HEADER CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A]">Settings</h1>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Manage your Professional Credentials, Available Timings, Multiple Teaching Modes, Verification Documents, and Security Settings.
          </p>
        </div>
      </div>

      {uploading && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs font-bold animate-pulse">
          ⏳ Processing and uploading media securely...
        </div>
      )}

      {/* FORM CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm">
        <form onSubmit={handleSave} className="space-y-6">
          
          {/* SECTION: PERSONAL & CONTACT INFORMATION */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Personal & Contact Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">Full Name</label>
                <input 
                  type="text" 
                  value={formData.fullName} 
                  onChange={(e) => setFormData({...formData, fullName: e.target.value})} 
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#0F172A]" 
                  required 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">Email (Locked)</label>
                <input 
                  type="email" 
                  value={tutorEmail} 
                  disabled 
                  className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl text-xs text-gray-400 cursor-not-allowed font-medium" 
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">Phone Number</label>
                <input 
                  type="text" 
                  value={formData.phone_number} 
                  onChange={(e) => setFormData({...formData, phone_number: e.target.value})} 
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">WhatsApp Number</label>
                <input 
                  type="text" 
                  value={formData.whatsapp_number} 
                  onChange={(e) => setFormData({...formData, whatsapp_number: e.target.value})} 
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                />
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: COVER IMAGE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Cover Image</h3>
              <span className="text-[11px] text-gray-400 font-medium">Recommended size: 1200 × 400 px</span>
            </div>
            <div className="space-y-2 p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {formData.coverImageUrl ? (
                  <img 
                    src={formData.coverImageUrl} 
                    alt="Cover Preview" 
                    className="w-full sm:w-48 h-24 rounded-xl object-cover border border-gray-300 shadow-xs" 
                  />
                ) : (
                  <div className="w-full sm:w-48 h-24 rounded-xl bg-gray-200 flex items-center justify-center text-[11px] text-gray-400 font-medium border border-dashed border-gray-300">
                    No Cover Image
                  </div>
                )}
                <label className="px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs inline-block">
                  Browse Cover
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleCoverImageChange} 
                    className="hidden" 
                  />
                </label>
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: PROFILE & VERIFICATION PHOTOS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Profile & Verification Photos</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              
              {/* Profile Picture */}
              <div className="space-y-2 p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl">
                <label className="block text-xs font-bold text-[#0F172A]">Profile Picture</label>
                <div className="flex items-center gap-4">
                  <img 
                    src={formData.profileImage} 
                    alt="Profile" 
                    className="w-28 h-28 rounded-2xl object-cover border-2 border-emerald-500 shadow-md shrink-0" 
                  />
                  <label className="px-4 py-2.5 bg-[#0F172A] hover:bg-black text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs inline-block">
                    Browse
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleProfileImageChange}
                      className="hidden" 
                    />
                  </label>
                </div>
              </div>

              {/* Selfie */}
              <div className="space-y-2 p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl">
                <label className="block text-xs font-bold text-[#0F172A]">Selfie</label>
                <div className="flex items-center gap-4">
                  <img 
                    src={formData.selfieUrl || "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=150"} 
                    alt="Selfie" 
                    className="w-28 h-28 rounded-2xl object-cover border-2 border-blue-500 shadow-md shrink-0" 
                  />
                  <div className="space-y-1">
                    <label className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs inline-block">
                      Browse (Take Selfie)
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="user" 
                        onChange={handleSelfieCapture} 
                        className="hidden" 
                      />
                    </label>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: LOCATION & MULTIPLE TEACHING MODES */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Location & Teaching Modes</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">City</label>
                <input 
                  type="text" 
                  value={formData.city} 
                  onChange={(e) => setFormData({...formData, city: e.target.value})} 
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                  required 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0F172A]">Area Name</label>
                <input 
                  type="text" 
                  value={formData.areaName} 
                  onChange={(e) => setFormData({...formData, areaName: e.target.value})} 
                  className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                  required 
                />
              </div>
            </div>

            {/* MULTIPLE TEACHING MODES CHECKBOXES */}
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-[#0F172A]">Teaching Modes (Select all that you are comfortable with)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {["Physical", "Online", "School"].map((mode) => {
                  const isChecked = formData.teachingModes.includes(mode);
                  return (
                    <label 
                      key={mode} 
                      className={`flex items-center gap-3 p-3.5 rounded-2xl border text-xs font-bold cursor-pointer transition-all ${
                        isChecked ? 'bg-emerald-50 border-emerald-300 text-emerald-900 shadow-2xs' : 'bg-[#F8FAFC] border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => {
                          const updated = isChecked 
                            ? formData.teachingModes.filter(m => m !== mode)
                            : [...formData.teachingModes, mode];
                          setFormData({...formData, teachingModes: updated});
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" 
                      />
                      <span>{mode} Tutoring</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: SPECIALTY SUBJECTS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Specialty Subject(s)</h3>
            <div className="space-y-2">
              {specialtyList.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs">
                  <span className="font-bold text-[#0F172A]">{item.subject}</span>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-200">
                    Level: {item.level}
                  </span>
                  <button 
                    type="button" 
                    onClick={() => setSpecialtyList(specialtyList.filter((_, i) => i !== idx))} 
                    className="text-red-600 font-bold cursor-pointer"
                  >
                    Remove ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 items-center bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200">
              <input 
                type="text" 
                value={newSubjInput} 
                onChange={(e) => setNewSubjInput(e.target.value)} 
                placeholder="Enter Subject (e.g. Chemistry)" 
                className="p-3 bg-white border border-gray-200 rounded-xl text-xs font-medium" 
              />
              <div className="flex items-center gap-4 text-xs font-bold text-[#0F172A]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input 
                    type="radio" 
                    name="expertiseLevel" 
                    value="Basic" 
                    checked={newLevelInput === "Basic"} 
                    onChange={(e) => setNewLevelInput(e.target.value)} 
                  /> Basic
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input 
                    type="radio" 
                    name="expertiseLevel" 
                    value="Expert" 
                    checked={newLevelInput === "Expert"} 
                    onChange={(e) => setNewLevelInput(e.target.value)} 
                  /> Expert
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input 
                    type="radio" 
                    name="expertiseLevel" 
                    value="Advance" 
                    checked={newLevelInput === "Advance"} 
                    onChange={(e) => setNewLevelInput(e.target.value)} 
                  /> Advance
                </label>
              </div>
              <button 
                type="button" 
                onClick={addSpecialtySubject} 
                className="px-4 py-3 bg-[#0F172A] text-white font-bold rounded-xl text-xs cursor-pointer hover:bg-black transition-colors"
              >
                + Add Subject
              </button>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: AVAILABLE TIMINGS & SCHEDULE */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Available Timings & Booking Schedule</h3>
            <div className="space-y-2">
              {availabilityList.map((slot, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-[#0F172A]">{slot.day}</strong> — <span className="text-gray-600 font-medium">{slot.timeSlot}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAvailabilityList(availabilityList.filter((_, i) => i !== idx))} 
                    className="text-red-600 font-bold cursor-pointer"
                  >
                    Remove ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 items-center bg-[#F8FAFC] p-4 rounded-2xl border border-gray-200">
              <select 
                value={newDayInput} 
                onChange={(e) => setNewDayInput(e.target.value)} 
                className="p-3 bg-white border border-gray-200 rounded-xl text-xs font-medium"
              >
                <option value="Monday">Monday</option>
                <option value="Tuesday">Tuesday</option>
                <option value="Wednesday">Wednesday</option>
                <option value="Thursday">Thursday</option>
                <option value="Friday">Friday</option>
                <option value="Saturday">Saturday</option>
                <option value="Sunday">Sunday</option>
              </select>
              <input 
                type="text" 
                value={newTimeInput} 
                onChange={(e) => setNewTimeInput(e.target.value)} 
                placeholder="Time Slot (e.g. 04:00 PM - 07:00 PM)" 
                className="p-3 bg-white border border-gray-200 rounded-xl text-xs font-medium" 
              />
              <button 
                type="button" 
                onClick={addAvailabilitySlot} 
                className="px-4 py-3 bg-[#0F172A] text-white font-bold rounded-xl text-xs cursor-pointer hover:bg-black transition-colors"
              >
                + Add Timing Slot
              </button>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: VIDEO PORTFOLIO */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Video Portfolio</h3>
            <div className="p-5 bg-slate-900 rounded-2xl text-white space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400">YouTube Portfolio Video</h4>
              <p className="text-xs text-slate-300">
                Upload your portfolio video to showcase your teaching style directly.
              </p>
              <label className="inline-block px-5 py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-bold rounded-xl cursor-pointer shadow-md">
                {uploadingVideo ? "Uploading Portfolio..." : "Upload portfolio Video"}
                <input type="file" accept="video/*" className="hidden" onChange={handlePortfolioVideoUpload} disabled={uploadingVideo} />
              </label>
              {youtubeStatus && <p className="text-xs font-bold text-emerald-400">{youtubeStatus}</p>}
              {formData.videoIntroUrl && (
                <p className="text-[11px] text-blue-400 font-mono">🔗 Portfolio Video Linked: {formData.videoIntroUrl}</p>
              )}
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: ANTI-DOWNLOAD PROTECTED DOCUMENTS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Anti-Download Protected Documents</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* CNIC Front */}
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span>🆔 CNIC Front Verification</span>
                  <span className={formData.cnicFrontUrl ? "text-emerald-600 font-bold" : "text-gray-400"}>
                    {formData.cnicFrontUrl ? "Uploaded ✓" : "Not Uploaded"}
                  </span>
                </div>
                <label className="block w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs text-center font-bold text-[#0F172A] cursor-pointer hover:bg-gray-50 transition-colors">
                  {formData.cnicFrontUrl ? "Change File" : "Browse"}
                  <input 
                    type="file" 
                    accept="image/*,application/pdf" 
                    onChange={(e) => handleFileUploadField(e, 'cnicFrontUrl')}
                    className="hidden" 
                  />
                </label>
                {formData.cnicFrontUrl && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                    <span className="text-emerald-900 font-bold truncate">📄 CNIC Front File Linked</span>
                    <a href={formData.cnicFrontUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline shrink-0 ml-2">
                      View Securely ↗
                    </a>
                  </div>
                )}
              </div>

              {/* CNIC Back */}
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-2xl space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span>🆔 CNIC Back Verification</span>
                  <span className={formData.cnicBackUrl ? "text-emerald-600 font-bold" : "text-gray-400"}>
                    {formData.cnicBackUrl ? "Uploaded ✓" : "Not Uploaded"}
                  </span>
                </div>
                <label className="block w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs text-center font-bold text-[#0F172A] cursor-pointer hover:bg-gray-50 transition-colors">
                  {formData.cnicBackUrl ? "Change File" : "Browse"}
                  <input 
                    type="file" 
                    accept="image/*,application/pdf" 
                    onChange={(e) => handleFileUploadField(e, 'cnicBackUrl')}
                    className="hidden" 
                  />
                </label>
                {formData.cnicBackUrl && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                    <span className="text-emerald-900 font-bold truncate">📄 CNIC Back File Linked</span>
                    <a href={formData.cnicBackUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline shrink-0 ml-2">
                      View Securely ↗
                    </a>
                  </div>
                )}
              </div>

            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: DEGREES */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Degrees</h3>
            <div className="space-y-2">
              {degrees.map((deg, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-[#0F172A]">{deg.title}</strong> — <span className="text-gray-600">{deg.institute} ({deg.year})</span>
                    <div className="text-[10px] text-emerald-700 font-mono">🔒 Protected</div>
                  </div>
                  <button type="button" onClick={() => setDegrees(degrees.filter((_, i) => i !== idx))} className="text-red-600 font-bold px-2 py-1 cursor-pointer">Remove ✕</button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 items-center">
              <input type="text" value={newDegree.title} onChange={(e) => setNewDegree({...newDegree, title: e.target.value})} placeholder="Degree Title" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newDegree.institute} onChange={(e) => setNewDegree({...newDegree, institute: e.target.value})} placeholder="Institute" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newDegree.year} onChange={(e) => setNewDegree({...newDegree, year: e.target.value})} placeholder="Year" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <label className="block p-3 bg-white border border-gray-200 rounded-xl text-xs text-center font-bold text-[#0F172A] cursor-pointer hover:bg-gray-50 transition-colors">
                Browse
                <input type="file" onChange={handleAddDegree} className="hidden" />
              </label>
            </div>
            <button type="button" onClick={pushDegree} className="px-4 py-2.5 bg-[#0F172A] text-white font-bold rounded-xl text-xs cursor-pointer">+ Add Degree Document</button>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: CERTIFICATIONS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0F172A]">Certifications & Document Uploads</h3>
            <div className="space-y-2">
              {certifications.map((cert, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-[#0F172A]">{cert.title}</strong> — <span className="text-gray-600">{cert.issuer} ({cert.year})</span>
                    <div className="text-[10px] text-emerald-700 font-mono">🔒 Protected</div>
                  </div>
                  <button type="button" onClick={() => setCertifications(certifications.filter((_, i) => i !== idx))} className="text-red-600 font-bold px-2 py-1 cursor-pointer">Remove ✕</button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 items-center">
              <input type="text" value={newCert.title} onChange={(e) => setNewCert({...newCert, title: e.target.value})} placeholder="Certification Title" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newCert.issuer} onChange={(e) => setNewCert({...newCert, issuer: e.target.value})} placeholder="Issuer" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newCert.year} onChange={(e) => setNewCert({...newCert, year: e.target.value})} placeholder="Year" className="p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" />
              <label className="block p-3 bg-white border border-gray-200 rounded-xl text-xs text-center font-bold text-[#0F172A] cursor-pointer hover:bg-gray-50 transition-colors">
                Browse
                <input type="file" onChange={handleAddCert} className="hidden" />
              </label>
            </div>
            <button type="button" onClick={pushCert} className="px-4 py-2.5 bg-[#0F172A] text-white font-bold rounded-xl text-xs cursor-pointer">+ Add Certification Document</button>
          </div>

          {/* SAVE BUTTON & SUCCESS MESSAGE POSITIONED TOGETHER */}
          <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center gap-4">
            <button 
              type="submit" 
              disabled={uploading} 
              className="flex-1 w-full py-4 bg-[#d60008] hover:bg-red-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer"
            >
              {uploading ? "Saving Profile Settings..." : "Save Profile Settings & Media ➔"}
            </button>

            {successMsg && (
              <div className="w-full sm:w-auto px-5 py-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-bold shadow-sm shrink-0 flex items-center justify-center">
                {successMsg}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* SECTION: CHANGE PASSWORD (SEPARATE CARD) */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        <div className="space-y-1">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0F172A]">Change Password</h3>
          <p className="text-xs text-gray-500 font-medium">Update your account password securely.</p>
        </div>

        {passwordMsg && (
          <div className={`p-3 rounded-xl text-xs font-bold ${passwordMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-900 border border-red-200'}`}>
            {passwordMsg}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#0F172A]">New Password</label>
              <input 
                type="password" 
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)} 
                placeholder="••••••••" 
                className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                required 
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#0F172A]">Confirm New Password</label>
              <input 
                type="password" 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                placeholder="••••••••" 
                className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs font-medium" 
                required 
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={passwordLoading} 
            className="px-6 py-3.5 bg-[#0F172A] hover:bg-black text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer"
          >
            {passwordLoading ? "Updating Password..." : "Update Password ➔"}
          </button>
        </form>
      </div>

    </main>
  );
}