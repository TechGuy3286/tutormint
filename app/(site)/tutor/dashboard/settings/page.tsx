"use client";

import FileUpload from '@/components/FileUpload';
import { submitForm } from '@/lib/submit'
import { TEACHING_MODES, canonicalMode } from '@/lib/locations'
import { teachingMode } from '@/lib/display'

import Breadcrumbs from '@/components/Breadcrumbs'
import Avatar from '@/components/Avatar'
import { X, Plus, Save } from 'lucide-react'
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
    videoIntroUrl: ""
  });
  // The selfie is a PRIVATE document (user_documents kind='selfie'), not a
  // tutor_profiles column. This state holds only the authorising preview
  // route, /api/documents/<id>/preview -- no storage URL ever reaches this
  // page. selfie_url used to be written here with a public tutor-media URL;
  // that writer is the defect migration 45 exists to close.
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState("");

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
          videoIntroUrl: data.video_intro_url || ""
        });
        // Latest selfie document, if one exists. Owner-read RLS on
        // user_documents makes this the member's own row only; the preview
        // URL is the authorising route, not a storage path.
        const { data: selfieDoc } = await supabase
          .from('user_documents')
          .select('id')
          .eq('user_id', user.id)
          .eq('kind', 'selfie')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selfieDoc) setSelfiePreviewUrl(`/api/documents/${selfieDoc.id}/preview`);
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
        // degrees is stored as text[] on some rows (a bare string per degree)
        // and object[] on others. Coerce a string entry to the object shape so
        // the row renders its title instead of an empty "()". Display only.
        const asDegree = (d: unknown) =>
          typeof d === 'string'
            ? { title: d, institute: '', year: '', fileName: '', fileUrl: '' }
            : (d as { title: string; institute: string; year: string; fileName: string; fileUrl: string });
        const asCert = (c: unknown) =>
          typeof c === 'string'
            ? { title: c, issuer: '', year: '', fileName: '', fileUrl: '' }
            : (c as { title: string; issuer: string; year: string; fileName: string; fileUrl: string });
        setDegrees(Array.isArray(data.degrees) ? data.degrees.map(asDegree) : []);
        setCertifications(Array.isArray(data.certifications) ? data.certifications.map(asCert) : []);
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

  const handleSelfieCapture = async (file: File) => {
    // NOT uploadFileToCloud. That helper targets the public tutor-media
    // bucket, which is right for the avatar and the cover and was wrong for
    // a verification photo of a person's face. The selfie goes through the
    // same private flow as the CNIC: identity-docs bucket, EXIF stripped,
    // served only through the authorising preview route to owner and admin.
    setUploading(true);
    try {
      const body = new FormData();
      body.append('kind', 'selfie');
      body.append('file', file);
      const res = await fetch('/api/documents/upload', { method: 'POST', body });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.previewUrl) {
        setSelfiePreviewUrl(data.previewUrl);
      } else {
        alert(data?.error || 'That photo could not be uploaded. Try a JPG or PNG.');
      }
    } catch {
      alert('That photo could not be uploaded. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
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
        // selfie_url is NOT written any more. The selfie is a private
        // user_documents row (kind='selfie') since migration 45 -- the upload
        // handler stores it; nothing about it belongs in this upsert.
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
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-6 font-sans text-slate-700 sm:px-6">
      {/* Was a hand-rolled trail with no Home entry and no BreadcrumbList. */}
      <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Settings' }]} />

      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Settings</h1>
        <p className="text-xs text-gray-500">
          Your profile, subjects, availability and documents — one card per thing.
        </p>
      </header>

      {uploading && (
        <p className="rounded-xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-xs font-bold text-tm-navy">
          Uploading securely…
        </p>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* ---------------------------------------------------------- details */}
        <Card title="Your details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="sr-only">Full name</span>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="Full name"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium focus:border-tm-navy focus:outline-none"
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="sr-only">Email (cannot be changed)</span>
              <input
                type="email"
                value={tutorEmail}
                disabled
                aria-label="Email, cannot be changed"
                className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 p-3 text-xs font-medium text-gray-500"
              />
            </label>
            <label className="block space-y-1">
              <span className="sr-only">Phone number</span>
              <input
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                placeholder="Phone number"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
            <label className="block space-y-1">
              <span className="sr-only">WhatsApp number</span>
              <input
                type="tel"
                value={formData.whatsapp_number}
                onChange={(e) => setFormData({ ...formData, whatsapp_number: e.target.value })}
                placeholder="WhatsApp number"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
          </div>
        </Card>

        {/* ----------------------------------------------------------- photos */}
        <Card title="Your photos" hint="Your profile photo is what parents see. Your selfie is held for verification only and never shown.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FileUpload
              label="Profile photo"
              acceptLabel="JPG or PNG"
              shape="square"
              changeLabel="Change photo"
              busy={uploading}
              onFile={handleProfileImageChange}
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
            <FileUpload
              label="Verification selfie"
              acceptLabel="JPG or PNG"
              shape="square"
              changeLabel="Retake"
              busy={uploading}
              onFile={handleSelfieCapture}
              currentPreview={
                selfiePreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selfiePreviewUrl}
                    alt="Your verification selfie"
                    className="h-full w-full object-cover"
                  />
                ) : undefined
              }
            />
          </div>
        </Card>

        {/* --------------------------------------------------------- location */}
        <Card title="Where you teach">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="sr-only">City</span>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="City"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="sr-only">Area</span>
              <input
                type="text"
                value={formData.areaName}
                onChange={(e) => setFormData({ ...formData, areaName: e.target.value })}
                placeholder="Area"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
                required
              />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-tm-navy">How you teach</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TEACHING_MODES.filter((m) => m !== 'both').map((mode) => {
                const isChecked = formData.teachingModes.includes(mode);
                return (
                  <label
                    key={mode}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold transition-colors ${
                      isChecked
                        ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                        : 'border-gray-200 bg-tm-bg text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        const updated = isChecked
                          ? formData.teachingModes.filter((m) => m !== mode)
                          : [...formData.teachingModes, mode];
                        setFormData({ ...formData, teachingModes: updated });
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-tm-green-deep focus:ring-tm-green-deep"
                    />
                    <span>{teachingMode(mode)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Card>

        {/* --------------------------------------------------------- subjects */}
        <Card title="Subjects you specialise in">
          {specialtyList.length > 0 && (
            <ul className="space-y-2">
              {specialtyList.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs"
                >
                  <span className="font-bold text-tm-navy">{item.subject}</span>
                  <span className="rounded-lg border border-tm-green-deep/30 bg-tm-tint-green px-2.5 py-1 font-bold text-tm-green-deep">
                    {item.level}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSpecialtyList(specialtyList.filter((_, i) => i !== idx))}
                    aria-label={`Remove ${item.subject}`}
                    className="ml-auto inline-flex min-h-[36px] items-center gap-1 font-bold text-tm-red"
                  >
                    <X aria-hidden size={13} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
            <label className="block sm:col-span-1">
              <span className="sr-only">Subject</span>
              <input
                type="text"
                value={newSubjInput}
                onChange={(e) => setNewSubjInput(e.target.value)}
                placeholder="Subject, e.g. Chemistry"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
            <div className="flex items-center gap-4 text-xs font-bold text-tm-navy">
              {['Basic', 'Expert', 'Advance'].map((lvl) => (
                <label key={lvl} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="expertiseLevel"
                    value={lvl}
                    checked={newLevelInput === lvl}
                    onChange={(e) => setNewLevelInput(e.target.value)}
                  />
                  {lvl}
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={addSpecialtySubject}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white"
            >
              <Plus aria-hidden size={14} /> Add subject
            </button>
          </div>
        </Card>

        {/* ----------------------------------------------------- availability */}
        <Card title="When you are available">
          {availabilityList.length > 0 && (
            <ul className="space-y-2">
              {availabilityList.map((slot, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs"
                >
                  <span>
                    <strong className="text-tm-navy">{slot.day}</strong>{' '}
                    <span className="font-medium text-gray-500">{slot.timeSlot}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAvailabilityList(availabilityList.filter((_, i) => i !== idx))}
                    aria-label={`Remove ${slot.day} ${slot.timeSlot}`}
                    className="inline-flex min-h-[36px] items-center gap-1 font-bold text-tm-red"
                  >
                    <X aria-hidden size={13} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
            <label className="block">
              <span className="sr-only">Day</span>
              <select
                value={newDayInput}
                onChange={(e) => setNewDayInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              >
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Time slot</span>
              <input
                type="text"
                value={newTimeInput}
                onChange={(e) => setNewTimeInput(e.target.value)}
                placeholder="Time, e.g. 4:00 PM – 7:00 PM"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
            <button
              type="button"
              onClick={addAvailabilitySlot}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white"
            >
              <Plus aria-hidden size={14} /> Add time
            </button>
          </div>
        </Card>

        {/* ------------------------------------------------------------ video */}
        <Card title="Introduction video" hint="Upload a short video showing how you teach. It is reviewed before it appears on your profile.">
          <FileUpload
            label="Introduction video"
            accept="video/*"
            acceptLabel="MP4 or MOV"
            maxBytes={200 * 1024 * 1024}
            busy={uploadingVideo}
            onFile={handlePortfolioVideoUpload}
          />
          {youtubeStatus && <p className="text-xs font-bold text-tm-green-deep">{youtubeStatus}</p>}
          {formData.videoIntroUrl && (
            <p className="text-[11px] font-semibold text-gray-500">Your introduction video is linked.</p>
          )}
        </Card>

        {/* --------------------------------------------------------- identity */}
        {/* Was "ANTI-DOWNLOAD PROTECTED DOCUMENTS", whose heading was the only
            protection in it: both CNIC sides went to the PUBLIC tutor-media
            bucket. It renders the shared IdentityCard now — private bucket,
            watermarked previews, served only through an authorising route. */}
        {identity && <IdentityCard identity={identity} role="tutor" />}

        {/* ---------------------------------------------------------- degrees */}
        <Card title="Degrees" hint="Your certificate images are private — watermarked previews only, never downloadable.">
          {degrees.length > 0 && (
            <ul className="space-y-2">
              {degrees.map((deg, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs"
                >
                  <span>
                    <strong className="text-tm-navy">{deg.title}</strong>
                    {(deg.institute || deg.year) && (
                      <span className="text-gray-500">
                        {' '}
                        {[deg.institute, deg.year].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDegrees(degrees.filter((_, i) => i !== idx))}
                    aria-label={`Remove ${deg.title}`}
                    className="inline-flex min-h-[36px] items-center gap-1 font-bold text-tm-red"
                  >
                    <X aria-hidden size={13} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-center">
            <label className="block">
              <span className="sr-only">Degree title</span>
              <input type="text" value={newDegree.title} onChange={(e) => setNewDegree({ ...newDegree, title: e.target.value })} placeholder="Degree" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <label className="block">
              <span className="sr-only">Institute</span>
              <input type="text" value={newDegree.institute} onChange={(e) => setNewDegree({ ...newDegree, institute: e.target.value })} placeholder="Institute" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <label className="block">
              <span className="sr-only">Year</span>
              <input type="text" value={newDegree.year} onChange={(e) => setNewDegree({ ...newDegree, year: e.target.value })} placeholder="Year" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <FileUpload label="Degree certificate" acceptLabel="JPG or PNG" busy={uploading} onFile={handleAddDegree} />
          </div>
          <button
            type="button"
            onClick={pushDegree}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white"
          >
            <Plus aria-hidden size={14} /> Add degree
          </button>
        </Card>

        {/* --------------------------------------------------- certifications */}
        <Card title="Certifications" hint="Optional. Same private treatment as your degrees.">
          {certifications.length > 0 && (
            <ul className="space-y-2">
              {certifications.map((cert, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs"
                >
                  <span>
                    <strong className="text-tm-navy">{cert.title}</strong>
                    {(cert.issuer || cert.year) && (
                      <span className="text-gray-500">
                        {' '}
                        {[cert.issuer, cert.year].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCertifications(certifications.filter((_, i) => i !== idx))}
                    aria-label={`Remove ${cert.title}`}
                    className="inline-flex min-h-[36px] items-center gap-1 font-bold text-tm-red"
                  >
                    <X aria-hidden size={13} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-center">
            <label className="block">
              <span className="sr-only">Certification title</span>
              <input type="text" value={newCert.title} onChange={(e) => setNewCert({ ...newCert, title: e.target.value })} placeholder="Certification" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <label className="block">
              <span className="sr-only">Issuer</span>
              <input type="text" value={newCert.issuer} onChange={(e) => setNewCert({ ...newCert, issuer: e.target.value })} placeholder="Issuer" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <label className="block">
              <span className="sr-only">Year</span>
              <input type="text" value={newCert.year} onChange={(e) => setNewCert({ ...newCert, year: e.target.value })} placeholder="Year" className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium" />
            </label>
            <FileUpload label="Certification document" acceptLabel="JPG or PNG" busy={uploading} onFile={handleAddCert} />
          </div>
          <button
            type="button"
            onClick={pushCert}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white"
          >
            <Plus aria-hidden size={14} /> Add certification
          </button>
        </Card>

        {/* ------------------------------------------------------------- save */}
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex min-h-[48px] w-full flex-1 items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-xs font-extrabold text-white hover:bg-tm-red-hover disabled:opacity-60"
          >
            <Save aria-hidden size={15} /> {uploading ? 'Saving…' : 'Save changes'}
          </button>
          {successMsg && (
            <p className="shrink-0 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green px-4 py-3 text-xs font-bold text-tm-green-deep">
              {successMsg}
            </p>
          )}
        </div>
      </form>

      {/* ------------------------------------------------------------ password */}
      <Card title="Change password" hint="Update your account password.">
        {passwordMsg && (
          <p
            className={`rounded-xl p-3 text-xs font-bold ${
              passwordMsg.startsWith('✅')
                ? 'border border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                : 'border border-tm-red/30 bg-tm-tint-red text-tm-red'
            }`}
          >
            {passwordMsg}
          </p>
        )}
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="sr-only">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
                required
              />
            </label>
            <label className="block">
              <span className="sr-only">Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
                required
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={passwordLoading}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-black px-6 text-xs font-extrabold text-white disabled:opacity-60"
          >
            <Save aria-hidden size={15} /> {passwordLoading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </Card>
    </main>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="space-y-0.5">
        <h2 className="text-sm font-black text-tm-navy">{title}</h2>
        {hint && <p className="text-[11px] leading-relaxed text-gray-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
