"use client";

import FileUpload from '@/components/FileUpload';
import { submitForm } from '@/lib/submit'
import { TEACHING_MODES, canonicalMode } from '@/lib/locations'
import { teachingMode } from '@/lib/display'

import Breadcrumbs from '@/components/Breadcrumbs'
import Avatar from '@/components/Avatar'
import IdentityCard from '@/components/identity/IdentityCard'
import type { Identity } from '@/lib/identity'
import { reportSilentFailure } from '@/lib/silentFailure'
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function TutorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [tutorEmail, setTutorEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState("");
  // The identity card's data. Over HTTP because this page is a client
  // component; the two dashboards call loadIdentity() on the server.
  const [identity, setIdentity] = useState<Identity | null>(null);

  // Change Password States
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [formData, setFormData] = useState({
    // Empty, not sample data. These carried a real member's name, mobile and
    // area as defaults, which flashed on screen for every tutor before their
    // own row loaded -- and CLAUDE.md rule 7 forbids mock data in a shipped
    // page for exactly that reason.
    fullName: "",
    phone_number: "",
    whatsapp_number: "",
    city: "",
    areaName: "",
    teachingModes: ['in_person'] as string[],
    profileImage: "",
    coverImageUrl: "",
    selfieUrl: "",
    videoIntroUrl: ""
  });

  // EMPTY DEFAULTS, and this is not tidying.
  //
  // These four lists were seeded with plausible sample content -- an MS
  // Mathematics from LUMS, a Cambridge Certified Educator certificate, Physics
  // at "Advance", Monday and Wednesday 4-7pm. The load below then only
  // overwrote a list when the tutor's own row had one:
  //
  //     if (data.degrees && data.degrees.length > 0) setDegrees(data.degrees)
  //
  // so a tutor with no degrees kept the sample, and Save wrote it to their
  // profile as a qualification they had never claimed. It has already
  // happened: one live tutor carries "MS Mathematics — LUMS, Lahore (2021)"
  // and two carry the Cambridge certificate, none of them entered by the
  // person they are attributed to. On a platform that sells degree-verified
  // tutors that is the most damaging possible thing to invent.
  //
  // Empty defaults, and every list is set unconditionally from the row.
  const [specialtyList, setSpecialtyList] = useState<{ subject: string; level: string }[]>([]);
  const [newSubjInput, setNewSubjInput] = useState("");
  const [newLevelInput, setNewLevelInput] = useState("Basic");

  // Availability & Timings
  const [availabilityList, setAvailabilityList] = useState<{ day: string; timeSlot: string }[]>([]);
  const [newDayInput, setNewDayInput] = useState("Monday");
  const [newTimeInput, setNewTimeInput] = useState("");

  const [degrees, setDegrees] = useState<
    { title: string; institute: string; year: string; fileName: string; fileUrl: string }[]
  >([]);
  const [newDegree, setNewDegree] = useState({ title: "", institute: "", year: "", fileName: "", fileUrl: "" });

  const [certifications, setCertifications] = useState<
    { title: string; issuer: string; year: string; fileName: string; fileUrl: string }[]
  >([]);
  const [newCert, setNewCert] = useState({ title: "", issuer: "", year: "", fileName: "", fileUrl: "" });

  useEffect(() => {
    loadTutorProfile();
  }, []);

  // The identity card's data. A failure here hides the card rather than
  // breaking the page: the rest of the settings screen is still usable, and
  // the card is also on the dashboard.
  useEffect(() => {
    let live = true;
    fetch('/api/identity', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.identity) setIdentity(j.identity as Identity);
      })
      .catch((e) => reportSilentFailure('TutorSettings.identity', e));
    return () => {
      live = false;
    };
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
        // One stored value, expanded back into the two checkboxes it came
        // from. 'both' ticks both; anything else ticks the one it names.
        // Older rows held a comma-joined string ('Physical, Online') and the
        // legacy spellings, so those are still read -- migration 35 converted
        // them, but a browser tab open across the deploy has not reloaded.
        const stored = typeof data.teaching_mode === 'string' ? data.teaching_mode.toLowerCase() : '';
        const parsedModes: string[] =
          stored.includes(',') || stored.includes('both')
            ? ['in_person', 'online']
            : stored.includes('online') || stored.includes('remote')
              ? ['online']
              : ['in_person'];

        setFormData({
          fullName: data.full_name || "",
          phone_number: data.phone_number || "",
          whatsapp_number: data.whatsapp_number || "",
          city: data.city || "",
          areaName: data.area || "",
          teachingModes: parsedModes,
          profileImage: data.avatar_url || formData.profileImage,
          coverImageUrl: data.cover_image_url || "",
          selfieUrl: data.selfie_url || "",
          videoIntroUrl: data.video_intro_url || ""
        });
        // Set UNCONDITIONALLY. The `length > 0` guards these had were the
        // mechanism of the bug above: an empty row left the sample content in
        // place, and the next Save wrote it as the tutor's own.
        setSpecialtyList(
          Array.isArray(data.specialty_list)
            ? data.specialty_list
            : data.specialty_subjects
              ? [{ subject: data.specialty_subjects, level: "Expert" }]
              : [],
        );
        setAvailabilityList(Array.isArray(data.availability_list) ? data.availability_list : []);
        setDegrees(Array.isArray(data.degrees) ? data.degrees : []);
        setCertifications(Array.isArray(data.certifications) ? data.certifications : []);
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

  const handleProfileImageChange = async (file: File) => {

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, profileImage: publicUrl }));
    }
    setUploading(false);
  };

  const handleCoverImageChange = async (file: File) => {

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, coverImageUrl: publicUrl }));
    }
    setUploading(false);
  };

  const handleSelfieCapture = async (file: File) => {

    setUploading(true);
    const publicUrl = await uploadFileToCloud(file);
    if (publicUrl) {
      setFormData(prev => ({ ...prev, selfieUrl: publicUrl }));
    }
    setUploading(false);
  };

  const handlePortfolioVideoUpload = async (file: File) => {

    setUploadingVideo(true);
    setYoutubeStatus("Uploading portfolio video directly to YouTube...");

    const uploadData = new FormData();
    uploadData.append("video", file);
    uploadData.append("title", `${formData.fullName} Portfolio Video | TutorMint`);
    uploadData.append("description", `Verified portfolio video submitted via TutorMint.`);

    // /tutor/upload-youtube, NOT /api/tutor/upload-youtube. There is no route
    // at the /api path and never was: app/api/tutor/ holds claim/ and jobs/
    // only, so this POST answered 404 and video upload from this screen has
    // been dead. The working handler is app/tutor/upload-youtube/route.ts,
    // which is what /tutor/complete-profile has always posted to.
    const res = await submitForm<{
      success?: boolean
      videoId?: string
      attemptsLeft?: number
      error?: string
    }>("/tutor/upload-youtube", uploadData)

    if (!res.ok || !res.data?.success) {
      // The route's own message when it has one -- it explains a missing
      // YouTube credential and a used-up third attempt in words a tutor can
      // act on -- and submitForm's bounded failure when it does not.
      setYoutubeStatus("Upload failed: " + (res.data?.error ?? res.error ?? "please try again."))
      setUploadingVideo(false)
      return
    }

    // The route returns `videoId`, not `videoUrl`; reading the wrong key here
    // stored `undefined` on every successful upload.
    setFormData(prev => ({
      ...prev,
      videoIntroUrl: res.data?.videoId ? `https://www.youtube.com/watch?v=${res.data.videoId}` : prev.videoIntroUrl,
    }));
    setYoutubeStatus(
      typeof res.data.attemptsLeft === 'number'
        ? `Video submitted for review. ${res.data.attemptsLeft} submission${res.data.attemptsLeft === 1 ? '' : 's'} left.`
        : "Video submitted for review.",
    )
    setUploadingVideo(false)
  };

  const handleAddDegree = async (file: File) => {
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

  const handleAddCert = async (file: File) => {
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
        area: formData.areaName,
        // ONE canonical value, never a joined list. This line used to be
        // `teachingModes.join(", ")`, which stored 'Physical, Online' -- a
        // spelling no filter matched and no display helper understood. It is
        // also what migration 35's CHECK constraint would now reject, turning
        // a routine save into a 500.
        teaching_mode: canonicalMode(formData.teachingModes),
        specialty_subjects: combinedSubjectsString,
        specialty_list: specialtyList,
        availability_list: availabilityList,
        avatar_url: formData.profileImage,
        cover_image_url: formData.coverImageUrl,
        selfie_url: formData.selfieUrl,
        // cnic_front_url / cnic_back_url are NOT written any more. They held
        // PUBLIC tutor-media URLs -- a national identity card fetchable by
        // anyone with the address -- and the identity card above stores both
        // sides in the private identity-docs bucket instead. The columns are
        // left in place rather than dropped so the two rows that already
        // carry a value stay findable; nothing reads them.
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
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 flex-1 w-full text-slate-700 font-sans">
      
      {/* Was a hand-rolled trail with no Home entry and no BreadcrumbList. */}
      <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Settings' }]} />

      {/* HEADER CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-tm-navy">Settings</h1>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Manage your Professional Credentials, Available Timings, Multiple Teaching Modes, Verification Documents, and Security Settings.
          </p>
        </div>
      </div>

      {uploading && (
        <div className="p-3 bg-tm-tint-navy border border-tm-navy/30 text-tm-navy rounded-xl text-xs font-bold animate-pulse">
          ⏳ Processing and uploading media securely...
        </div>
      )}

      {/* FORM CARD */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm">
        <form onSubmit={handleSave} className="space-y-6">
          
          {/* SECTION: PERSONAL & CONTACT INFORMATION */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Personal & Contact Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">Full Name</label>
                <input 
                  type="text" 
                  value={formData.fullName} 
                  onChange={(e) => setFormData({...formData, fullName: e.target.value})} 
                  className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-tm-navy" 
                  required 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">Email (Locked)</label>
                <input 
                  type="email" 
                  value={tutorEmail} 
                  disabled 
                  className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl text-xs text-gray-700 cursor-not-allowed font-medium" 
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">Phone Number</label>
                <input 
                  type="text" 
                  value={formData.phone_number} 
                  onChange={(e) => setFormData({...formData, phone_number: e.target.value})} 
                  className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">WhatsApp Number</label>
                <input 
                  type="text" 
                  value={formData.whatsapp_number} 
                  onChange={(e) => setFormData({...formData, whatsapp_number: e.target.value})} 
                  className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                />
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: COVER IMAGE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Cover Image</h3>
              <span className="text-[11px] text-gray-500 font-medium">Recommended size: 1200 × 400 px</span>
            </div>
            <div className="space-y-2 p-4 bg-tm-bg border border-gray-200 rounded-2xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {formData.coverImageUrl ? (
                  <img 
                    src={formData.coverImageUrl} 
                    alt="Cover Preview" 
                    className="w-full sm:w-48 h-24 rounded-xl object-cover border border-gray-300 shadow-xs" 
                  />
                ) : (
                  <div className="w-full sm:w-48 h-24 rounded-xl bg-gray-200 flex items-center justify-center text-[11px] text-gray-500 font-medium border border-dashed border-gray-300">
                    No Cover Image
                  </div>
                )}
                <FileUpload label="Cover image" acceptLabel="JPG or PNG" busy={uploading} onFile={handleCoverImageChange} />
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: PROFILE & VERIFICATION PHOTOS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Profile & Verification Photos</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              
              {/* Profile Picture.
                  ONE CONTROL, not a picture beside a drop zone. The old
                  arrangement showed the stored photo in an <Avatar> and the
                  uploader next to it, so after a successful upload the
                  uploader reverted to "Tap to choose" while the avatar showed
                  the new photo -- two components disagreeing about whether
                  anything had happened. FileUpload's square shape IS the
                  preview. */}
              <div className="space-y-2 p-4 bg-tm-bg border border-gray-200 rounded-2xl">
                <label className="block text-xs font-bold text-tm-navy">Profile picture</label>
                <FileUpload
                  label="Profile photo"
                  acceptLabel="JPG or PNG"
                  shape="square"
                  busy={uploading}
                  onFile={handleProfileImageChange}
                  hint="This is the photo parents see on your card and your profile."
                  currentPreview={
                    <Avatar
                      name={formData.fullName}
                      src={formData.profileImage || null}
                      decorative
                      ring=""
                      className="h-full w-full rounded-none text-2xl"
                    />
                  }
                />
              </div>

              {/* Selfie */}
              <div className="space-y-2 p-4 bg-tm-bg border border-gray-200 rounded-2xl">
                <label className="block text-xs font-bold text-tm-navy">Selfie</label>
                <FileUpload
                  label="Selfie"
                  acceptLabel="JPG or PNG"
                  shape="square"
                  changeLabel="Retake"
                  busy={uploading}
                  onFile={handleSelfieCapture}
                  hint="Held for verification only. It is never shown to parents."
                  currentPreview={
                    formData.selfieUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={formData.selfieUrl}
                        alt="Your verification selfie"
                        className="h-full w-full object-cover"
                      />
                    ) : undefined
                  }
                />
              </div>

            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: LOCATION & MULTIPLE TEACHING MODES */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Location & Teaching Modes</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">City</label>
                <input 
                  type="text" 
                  value={formData.city} 
                  onChange={(e) => setFormData({...formData, city: e.target.value})} 
                  className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                  required 
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-tm-navy">Area Name</label>
                <input 
                  type="text" 
                  value={formData.areaName} 
                  onChange={(e) => setFormData({...formData, areaName: e.target.value})} 
                  className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                  required 
                />
              </div>
            </div>

            {/* MULTIPLE TEACHING MODES CHECKBOXES */}
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-tm-navy">Teaching Modes (Select all that you are comfortable with)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEACHING_MODES.filter((m) => m !== 'both').map((mode) => {
                  const isChecked = formData.teachingModes.includes(mode);
                  return (
                    <label 
                      key={mode} 
                      className={`flex items-center gap-3 p-3.5 rounded-2xl border text-xs font-bold cursor-pointer transition-all ${
                        isChecked ? 'bg-tm-tint-green border-tm-green-deep/30 text-tm-green-deep shadow-2xs' : 'bg-tm-bg border-gray-200 text-gray-700 hover:bg-gray-100'
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
                        className="w-4 h-4 rounded border-gray-300 text-tm-green-deep focus:ring-tm-green-deep" 
                      />
                      <span>{teachingMode(mode)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: SPECIALTY SUBJECTS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Specialty Subject(s)</h3>
            <div className="space-y-2">
              {specialtyList.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs">
                  <span className="font-bold text-tm-navy">{item.subject}</span>
                  <span className="px-2.5 py-1 bg-tm-tint-green text-tm-green-deep font-bold rounded-lg border border-tm-green-deep/30">
                    Level: {item.level}
                  </span>
                  <button 
                    type="button" 
                    onClick={() => setSpecialtyList(specialtyList.filter((_, i) => i !== idx))} 
                    className="text-tm-red font-bold cursor-pointer"
                  >
                    Remove ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 items-center bg-tm-bg p-4 rounded-2xl border border-gray-200">
              <input 
                type="text" 
                value={newSubjInput} 
                onChange={(e) => setNewSubjInput(e.target.value)} 
                placeholder="Enter Subject (e.g. Chemistry)" 
                className="p-3 bg-white border border-gray-200 rounded-xl text-xs font-medium" 
              />
              <div className="flex items-center gap-4 text-xs font-bold text-tm-navy">
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
                className="px-4 py-3 bg-tm-black text-white font-bold rounded-xl text-xs cursor-pointer hover:bg-black transition-colors"
              >
                + Add Subject
              </button>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: AVAILABLE TIMINGS & SCHEDULE */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Available Timings & Booking Schedule</h3>
            <div className="space-y-2">
              {availabilityList.map((slot, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-tm-navy">{slot.day}</strong> — <span className="text-gray-600 font-medium">{slot.timeSlot}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAvailabilityList(availabilityList.filter((_, i) => i !== idx))} 
                    className="text-tm-red font-bold cursor-pointer"
                  >
                    Remove ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 items-center bg-tm-bg p-4 rounded-2xl border border-gray-200">
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
                className="px-4 py-3 bg-tm-black text-white font-bold rounded-xl text-xs cursor-pointer hover:bg-black transition-colors"
              >
                + Add Timing Slot
              </button>
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: VIDEO PORTFOLIO */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Video Portfolio</h3>
            <div className="p-5 bg-slate-900 rounded-2xl text-white space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-tm-mint">YouTube Portfolio Video</h4>
              <p className="text-xs text-slate-300">
                Upload your portfolio video to showcase your teaching style directly.
              </p>
              <FileUpload
                label="Portfolio video"
                accept="video/*"
                acceptLabel="MP4 or MOV"
                maxBytes={200 * 1024 * 1024}
                busy={uploadingVideo}
                onFile={handlePortfolioVideoUpload}
              />
              {youtubeStatus && <p className="text-xs font-bold text-tm-mint">{youtubeStatus}</p>}
              {formData.videoIntroUrl && (
                <p className="text-[11px] text-slate-300 font-mono">🔗 Portfolio Video Linked: {formData.videoIntroUrl}</p>
              )}
            </div>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* Identity documents.
              WAS "ANTI-DOWNLOAD PROTECTED DOCUMENTS", and the heading was the
              only protection in it: both CNIC sides went through the same
              helper as the avatar, into the PUBLIC tutor-media bucket, and the
              block below rendered a "View Securely" link to that public URL.
              Two real members' national identity cards were fetchable by
              anybody who had the address. It renders the shared IdentityCard
              now, which is the parent flow -- private bucket, watermarked
              previews, served only through an authorising route. */}
          {identity && <IdentityCard identity={identity} role="tutor" />}

          <hr className="border-gray-200 my-6" />

          {/* SECTION: DEGREES */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Degrees</h3>
            <div className="space-y-2">
              {degrees.map((deg, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-tm-navy">{deg.title}</strong> — <span className="text-gray-600">{deg.institute} ({deg.year})</span>
                    <div className="text-[10px] text-tm-green-deep font-mono">🔒 Protected</div>
                  </div>
                  <button type="button" onClick={() => setDegrees(degrees.filter((_, i) => i !== idx))} className="text-tm-red font-bold px-2 py-1 cursor-pointer">Remove ✕</button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 items-center">
              <input type="text" value={newDegree.title} onChange={(e) => setNewDegree({...newDegree, title: e.target.value})} placeholder="Degree Title" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newDegree.institute} onChange={(e) => setNewDegree({...newDegree, institute: e.target.value})} placeholder="Institute" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newDegree.year} onChange={(e) => setNewDegree({...newDegree, year: e.target.value})} placeholder="Year" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <FileUpload label="Degree document" acceptLabel="JPG or PNG" busy={uploading} onFile={handleAddDegree} />
            </div>
            <button type="button" onClick={pushDegree} className="px-4 py-2.5 bg-tm-black text-white font-bold rounded-xl text-xs cursor-pointer">+ Add Degree Document</button>
          </div>

          <hr className="border-gray-200 my-6" />

          {/* SECTION: CERTIFICATIONS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-tm-navy">Certifications & Document Uploads</h3>
            <div className="space-y-2">
              {certifications.map((cert, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs">
                  <div>
                    <strong className="text-tm-navy">{cert.title}</strong> — <span className="text-gray-600">{cert.issuer} ({cert.year})</span>
                    <div className="text-[10px] text-tm-green-deep font-mono">🔒 Protected</div>
                  </div>
                  <button type="button" onClick={() => setCertifications(certifications.filter((_, i) => i !== idx))} className="text-tm-red font-bold px-2 py-1 cursor-pointer">Remove ✕</button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 items-center">
              <input type="text" value={newCert.title} onChange={(e) => setNewCert({...newCert, title: e.target.value})} placeholder="Certification Title" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newCert.issuer} onChange={(e) => setNewCert({...newCert, issuer: e.target.value})} placeholder="Issuer" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <input type="text" value={newCert.year} onChange={(e) => setNewCert({...newCert, year: e.target.value})} placeholder="Year" className="p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" />
              <FileUpload label="Certification document" acceptLabel="JPG or PNG" busy={uploading} onFile={handleAddCert} />
            </div>
            <button type="button" onClick={pushCert} className="px-4 py-2.5 bg-tm-black text-white font-bold rounded-xl text-xs cursor-pointer">+ Add Certification Document</button>
          </div>

          {/* SAVE BUTTON & SUCCESS MESSAGE POSITIONED TOGETHER */}
          <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center gap-4">
            <button 
              type="submit" 
              disabled={uploading} 
              className="flex-1 w-full py-4 bg-tm-red hover:bg-tm-red-hover text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer"
            >
              {uploading ? "Saving Profile Settings..." : "Save Profile Settings & Media ➔"}
            </button>

            {successMsg && (
              <div className="w-full sm:w-auto px-5 py-4 bg-tm-tint-green border border-tm-green-deep/30 text-tm-green-deep rounded-xl text-xs font-bold shadow-sm shrink-0 flex items-center justify-center">
                {successMsg}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* SECTION: CHANGE PASSWORD (SEPARATE CARD) */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        <div className="space-y-1">
          <h3 className="text-sm font-black uppercase tracking-wider text-tm-navy">Change Password</h3>
          <p className="text-xs text-gray-500 font-medium">Update your account password securely.</p>
        </div>

        {passwordMsg && (
          <div className={`p-3 rounded-xl text-xs font-bold ${passwordMsg.startsWith('✅') ? 'bg-tm-tint-green text-tm-green-deep border border-tm-green-deep/30' : 'bg-tm-tint-red text-tm-red border border-tm-red/30'}`}>
            {passwordMsg}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-tm-navy">New Password</label>
              <input 
                type="password" 
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)} 
                placeholder="••••••••" 
                className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                required 
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-tm-navy">Confirm New Password</label>
              <input 
                type="password" 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                placeholder="••••••••" 
                className="w-full p-3 bg-tm-bg border border-gray-200 rounded-xl text-xs font-medium" 
                required 
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={passwordLoading} 
            className="px-6 py-3.5 bg-tm-black hover:bg-tm-black/90 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer"
          >
            {passwordLoading ? "Updating Password..." : "Update Password ➔"}
          </button>
        </form>
      </div>

    </main>
  );
}