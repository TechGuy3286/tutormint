"use client";

import FileUpload from '@/components/FileUpload';
import PhotoCaptureTile from '@/components/tutor/PhotoCaptureTile';
import { compressUnder1MB } from '@/lib/imageCompress';
import PasswordInput from '@/components/ui/PasswordInput'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'

import Breadcrumbs from '@/components/Breadcrumbs'
import Avatar from '@/components/Avatar'
import Link from 'next/link'
import { X, Plus, Save, ArrowRight, BadgeCheck, ShieldAlert } from 'lucide-react'
import IdentityCard from '@/components/identity/IdentityCard'
import IdentityDocsStatus from '@/components/tutor/IdentityDocsStatus'
import SubjectPicker from '@/components/tutor/SubjectPicker'
import VideoUpload from '@/components/tutor/VideoUpload'
import CredentialEditor, { type Credential } from '@/components/tutor/CredentialEditor'
import PublicPageStatus from '@/components/tutor/PublicPageStatus'
import EmailCard from '@/components/account/EmailCard'
import type { Identity } from '@/lib/identity'
import { formatPkMobile } from '@/lib/phone'
import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'
import { reportSilentFailure } from '@/lib/silentFailure'

// PR17 §3.2 — a verified number is changed through support (client-safe constant).
const mobileSupportHref = whatsappHref(
  SUPPORT_WHATSAPP_FALLBACK,
  'Assalam-o-Alaikum, I need to change the mobile number on my TutorMint account.',
)
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

// Tutor settings — ONE SAVE PER CARD (PR 3b §2.6). Each card owns its fields and
// its own Save button, showing "Saved." or the error inline; there is no
// page-wide Save. Change password keeps its own button. Photos, the identity
// card, the video and quick replies persist on their own action (upload / submit
// / save), so they carry no separate Save.

export default function TutorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { map: cityMap } = useCityAreas();
  const { titles: jobTitles } = useJobTitles();
  const [tutorEmail, setTutorEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);

  // Read-only verified mobile (PR 3b §2.2), from profiles.
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);

  // The tutor's public page (owner PR12 §3): their slug, and whether they are
  // LISTED — read from tutor_directory (the view returns the row only when the
  // tutor is in the public directory), so "View your public profile" vs the
  // not-live preview matches exactly what parents can see.
  const [publicSlug, setPublicSlug] = useState("");
  const [publicListed, setPublicListed] = useState(false);

  // Change Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [formData, setFormData] = useState({
    fullName: "",
    whatsapp: "",
    city: "",
    areaName: "",
    jobTypes: [] as string[],
    profileImage: "",
  });
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState("");
  const [selfieBusy, setSelfieBusy] = useState(false);
  const [selfieError, setSelfieError] = useState("");

  // Subjects are the tutor's taxonomy_master ids (SubjectPicker, PR 3b §2.4).
  const [subjectIds, setSubjectIds] = useState<number[]>([]);

  // Job-type demand, so the chips order by how much work each title has (§2.3).
  const [jobTypeDemand, setJobTypeDemand] = useState<Record<string, number>>({});

  const [availabilityList, setAvailabilityList] = useState<{ day: string; timeSlot: string }[]>([]);
  const [newDayInput, setNewDayInput] = useState("Monday");
  const [newTimeInput, setNewTimeInput] = useState("");

  const [degrees, setDegrees] = useState<Credential[]>([]);
  const [certifications, setCertifications] = useState<Credential[]>([]);

  const [videoAttempts, setVideoAttempts] = useState(0);
  const [videoStatus, setVideoStatus] = useState("none");

  useEffect(() => {
    loadTutorProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/identity', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.identity) setIdentity(j.identity as Identity);
      })
      .catch((e) => reportSilentFailure('TutorSettings.identity', e));
    fetch('/api/tutor/demand', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.jobTypeDemand) setJobTypeDemand(j.jobTypeDemand as Record<string, number>);
      })
      .catch(() => {});
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

      const [{ data: prof }, { data: tp }, { data: subjRows }, { data: dir }] = await Promise.all([
        supabase.from('profiles').select('phone_number, phone_verified_at').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
        supabase.from('tutor_directory').select('id').eq('id', user.id).maybeSingle(),
      ]);

      setPhoneNumber((prof?.phone_number as string) || "");
      setPhoneVerified(Boolean(prof?.phone_verified_at));
      setPublicSlug((tp?.slug as string) || "");
      setPublicListed(Boolean(dir));

      if (tp) {
        setFormData({
          fullName: tp.full_name || "",
          whatsapp: tp.whatsapp_number || "",
          // One city field for tutors: tutor_profiles.city is canonical (PR 3b §0).
          city: tp.city || "",
          areaName: tp.area || "",
          jobTypes: (tp.job_types as string[] | null) ?? [],
          profileImage: tp.avatar_url || "",
        });

        const { data: selfieDoc } = await supabase
          .from('user_documents')
          .select('id')
          .eq('user_id', user.id)
          .eq('kind', 'selfie')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selfieDoc) setSelfiePreviewUrl(`/api/documents/${selfieDoc.id}/preview`);

        setAvailabilityList(Array.isArray(tp.availability_list) ? tp.availability_list : []);

        const asDegree = (d: unknown) =>
          typeof d === 'string'
            ? { title: d, institute: '', year: '', fileName: '', fileUrl: '' }
            : (d as { title: string; institute: string; year: string; fileName: string; fileUrl: string });
        const asCert = (c: unknown) =>
          typeof c === 'string'
            ? { title: c, issuer: '', year: '', fileName: '', fileUrl: '' }
            : (c as { title: string; issuer: string; year: string; fileName: string; fileUrl: string });
        setDegrees(Array.isArray(tp.degrees) ? tp.degrees.map(asDegree) : []);
        setCertifications(Array.isArray(tp.certifications) ? tp.certifications.map(asCert) : []);
        setVideoAttempts((tp.video_attempts as number) ?? 0);
        setVideoStatus((tp.video_status as string) ?? 'none');
      }

      setSubjectIds((subjRows ?? []).map((r) => r.master_id as number));
    } catch (err) {
      console.error("Error loading tutor profile:", err);
    }
  };

  // ------------------------------------------------------------- uploads ----
  // A public-bucket photo, saved to the profile straight away (there is no
  // page-wide save any more to persist it later).
  const uploadFileToCloud = async (file: File): Promise<string | null> => {
    if (!userId) return null;
    const fileExt = file.name.split('.').pop();
    const filePath = `${userId}-${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('tutor-media').upload(filePath, file, { upsert: true });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from('tutor-media').getPublicUrl(filePath);
    return publicUrl;
  };

  const handleProfileImageChange = async (file: File) => {
    setUploading(true);
    try {
      const publicUrl = await uploadFileToCloud(file);
      if (publicUrl) {
        setFormData((prev) => ({ ...prev, profileImage: publicUrl }));
        const { error } = await supabase.from('tutor_profiles').update({ avatar_url: publicUrl }).eq('id', userId);
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error('Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSelfieCapture = async (file: File) => {
    setSelfieBusy(true);
    setSelfieError("");
    try {
      // Compressed under 1 MB for BOTH the camera and gallery path (PR22 §3), so a
      // raw camera photo never trips the serverless body cap.
      const img = await compressUnder1MB(file);
      const body = new FormData();
      body.append('kind', 'selfie');
      body.append('file', img);
      const res = await fetch('/api/documents/upload', { method: 'POST', body });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.previewUrl) setSelfiePreviewUrl(data.previewUrl);
      else throw new Error(data?.error || 'That photo could not be uploaded. Try a JPG or PNG.');
    } catch (e) {
      setSelfieError(e instanceof Error ? e.message : 'That photo could not be uploaded.');
    } finally {
      setSelfieBusy(false);
    }
  };

  const uploadCredential = async (file: File): Promise<string> =>
    (await uploadFileToCloud(file)) ?? "";

  const addAvailabilitySlot = () => {
    if (!newTimeInput.trim()) return;
    setAvailabilityList([...availabilityList, { day: newDayInput, timeSlot: newTimeInput.trim() }]);
    setNewTimeInput("");
  };

  // ---------------------------------------------------------- card saves ----
  const postProfileSave = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/profile/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Could not save.');
    }
  };

  const tutorUpdate = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('tutor_profiles').update(patch).eq('id', userId);
    if (error) throw new Error(error.message);
  };

  const saveDetails = () => tutorUpdate({ full_name: formData.fullName, whatsapp_number: formData.whatsapp });

  const saveLocation = async () => {
    // City is required wherever an area is collected (PR 3b §2.7): the listing
    // keys on the city, and an area with no city places nobody.
    if (!formData.city.trim()) {
      throw new Error('Add your city — you are not shown to parents without it.');
    }
    await postProfileSave({ profile: { city: formData.city }, tutorProfile: { area: formData.areaName } });
  };

  const saveJobTypes = () =>
    postProfileSave({ tutorProfile: { job_types: formData.jobTypes, teaching_mode: formData.jobTypes[0] ?? null } });

  const saveSubjects = () => postProfileSave({ subjectMasterIds: subjectIds });

  const saveAvailability = () => tutorUpdate({ availability_list: availabilityList });
  const saveDegrees = () => tutorUpdate({ degrees });
  const saveCertifications = () => tutorUpdate({ certifications });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setPasswordMsg("❌ New passwords do not match."); return; }
    if (newPassword.length < 6) { setPasswordMsg("❌ Password must be at least 6 characters."); return; }
    setPasswordLoading(true);
    setPasswordMsg("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg("✅ Password updated successfully!");
      setNewPassword(""); setConfirmPassword("");
    } catch (err) {
      setPasswordMsg("❌ Error: " + (err instanceof Error ? err.message : "Failed to update password"));
    } finally {
      setPasswordLoading(false);
    }
  };

  const orderedTitles = useMemo(
    () => [...jobTitles].sort((a, b) => (jobTypeDemand[b] ?? 0) - (jobTypeDemand[a] ?? 0)),
    [jobTitles, jobTypeDemand],
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-6 font-sans text-slate-700 sm:px-6">
      <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Settings' }]} />

      {/* Heading removed (PR61 §A1). The breadcrumb and the public-profile link
          below stay; the CV card is gone (it lives on the dashboard, §A2). */}

      {/* The tutor's public page (§3.1/§3.2): "View your public profile" when
          listed, or the not-live preview when not. */}
      {publicSlug && <PublicPageStatus slug={publicSlug} listed={publicListed} />}

      {/* Add or confirm an email (PR29 §4) — the other contact channel. */}
      <EmailCard />

      {/* ------------------------------------------------------------ details */}
      <Card title="Your details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="sr-only">Full name</span>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="Full name"
              className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium focus:border-tm-navy focus:outline-none"
            />
          </label>
          {/* Email lives in its own card now (EmailCard, PR29 §4): a mobile
              signup has no real email yet, so a disabled box showing the
              synthetic <msisdn>@users.tutormint.org address read as "your email,
              cannot be changed" — wrong on both counts. */}
        </div>

        {/* PR17 §3 — a verified number is read-only and changed through support;
            an unverified one is added/verified (and can be changed) in the
            mobile step of the profile flow. */}
        <div className="space-y-1">
          <p className="text-[11px] font-bold text-tm-navy">Mobile number</p>
          {phoneVerified ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
                <BadgeCheck aria-hidden size={15} />
                <span>{phoneNumber ? formatPkMobile(phoneNumber) : 'Verified'}</span>
                <span className="ml-auto text-[11px] font-black uppercase tracking-wider">Verified</span>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-500">
                Need to change it?{' '}
                {mobileSupportHref ? (
                  <a
                    href={mobileSupportHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-tm-green-deep hover:underline"
                  >
                    Contact support on WhatsApp
                  </a>
                ) : (
                  'Contact support.'
                )}
              </p>
            </>
          ) : (
            <Link
              href="/tutor/complete-profile?step=mobile"
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <ShieldAlert aria-hidden size={15} className="text-tm-red" />
              <span>{phoneNumber ? `${formatPkMobile(phoneNumber)} — not verified` : 'Add and verify your mobile number'}</span>
              <ArrowRight aria-hidden size={14} className="ml-auto shrink-0 text-tm-red" />
            </Link>
          )}
        </div>

        <label className="block">
          <span className="text-[11px] font-bold text-tm-navy">WhatsApp number</span>
          <input
            type="tel"
            value={formData.whatsapp}
            onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
            placeholder="WhatsApp number"
            className="mt-1 w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
          />
        </label>

        <SaveBar onSave={saveDetails} />
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
          {/* Selfie — the shared camera-or-gallery tile (PR22 §3): tap to Take a
              photo (front camera) or Choose from gallery. */}
          <div className="space-y-1.5">
            <div className="w-40">
              <PhotoCaptureTile
                facingMode="user"
                aspectClass="aspect-square"
                label="Selfie"
                ariaLabel="your verification selfie"
                busy={selfieBusy}
                done={!!selfiePreviewUrl}
                preview={
                  selfiePreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selfiePreviewUrl} alt="Your verification selfie" className="h-full w-full object-cover" />
                  ) : null
                }
                onPick={(f) => void handleSelfieCapture(f)}
              />
            </div>
            {selfieError && (
              <p role="alert" className="text-[11px] font-bold text-tm-red">{selfieError}</p>
            )}
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------------- location */}
      <Card title="Where you teach">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="sr-only">City</span>
            <input
              type="text"
              list="tutor-city-options"
              autoComplete="off"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="City"
              className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
            />
            <datalist id="tutor-city-options">
              {cityMap.cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {!formData.city.trim() && (
              <p className="text-[11px] font-bold text-tm-red">
                Add your city — you are not shown to parents without it.
              </p>
            )}
          </label>
          <label className="block space-y-1">
            <span className="sr-only">Area</span>
            <input
              type="text"
              list="tutor-area-options"
              autoComplete="off"
              value={formData.areaName}
              onChange={(e) => setFormData({ ...formData, areaName: e.target.value })}
              placeholder="Area"
              className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
            />
            <datalist id="tutor-area-options">
              {areasForCity(cityMap, formData.city).map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
        </div>
        <SaveBar onSave={saveLocation} />
      </Card>

      {/* --------------------------------------------------------- job type */}
      <Card title="Job Type" hint="Choose every title that fits — you are shown tuitions matching any of them. The busiest first.">
        <div className="flex flex-wrap gap-2">
          {orderedTitles.map((title) => {
            const on = formData.jobTypes.includes(title);
            return (
              <button
                key={title}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setFormData({
                    ...formData,
                    jobTypes: on
                      ? formData.jobTypes.filter((m) => m !== title)
                      : [...formData.jobTypes, title],
                  })
                }
                className={`inline-flex min-h-[44px] items-center rounded-xl border px-4 text-xs font-bold transition-colors ${
                  on
                    ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                    : 'border-gray-200 bg-tm-bg text-gray-700 hover:bg-gray-100'
                }`}
              >
                {title}
              </button>
            );
          })}
        </div>
        <SaveBar onSave={saveJobTypes} />
      </Card>

      {/* --------------------------------------------------------- subjects */}
      <Card title="Subjects you teach" hint="Search or pick from the grades with the most tuitions. What you have saved is already selected.">
        <SubjectPicker value={subjectIds} onChange={setSubjectIds} />
        <SaveBar onSave={saveSubjects} />
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
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addAvailabilitySlot}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <Plus aria-hidden size={14} /> Add time
            </button>
          </div>
        </div>
        <SaveBar onSave={saveAvailability} />
      </Card>

      {/* ------------------------------------------------------------ video */}
      <Card title="Introduction video" hint="A short clip showing how you teach, up to 200 MB. It is reviewed before it appears on your profile.">
        <VideoUpload initialAttempts={videoAttempts} initialStatus={videoStatus} onSubmitted={() => void loadTutorProfile()} />
      </Card>

      {/* --------------------------------------------------------- identity */}
      {identity && <IdentityCard identity={identity} role="tutor" />}

      {/* Verification status for CNIC, profile picture and selfie, + selfie
          upload (PR60). Self-loads; renders nothing until it has the status. */}
      <IdentityDocsStatus />

      {/* ---------------------------------------------------------- degrees */}
      <Card title="Degrees" hint="Your certificate images are private — watermarked previews only, never downloadable.">
        <CredentialEditor
          items={degrees}
          onChange={setDegrees}
          uploadFile={uploadCredential}
          noun="degree"
          titlePlaceholder="Degree (e.g. BSc Mathematics)"
          field2Key="institute"
          field2Placeholder="Institute"
          addLabel="Add degree"
        />
        <SaveBar onSave={saveDegrees} />
      </Card>

      {/* --------------------------------------------------- certifications */}
      <Card title="Certifications" hint="Optional. Same private treatment as your degrees.">
        <CredentialEditor
          items={certifications}
          onChange={setCertifications}
          uploadFile={uploadCredential}
          noun="certification"
          titlePlaceholder="Certification"
          field2Key="issuer"
          field2Placeholder="Issuer"
          addLabel="Add certification"
        />
        <SaveBar onSave={saveCertifications} />
      </Card>

      {/* Quick replies moved to the Messages page (PR61 §A3) — same editor,
          same saved data. */}

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
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
                required
              />
            </label>
            <label className="block">
              <span className="sr-only">Confirm new password</span>
              <PasswordInput
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

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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

// One Save button per card (PR 3b §2.6): saves that card only, shows "Saved." or
// the error inline. onSave throws to signal a failure.
function SaveBar({ onSave, label = 'Save' }: { onSave: () => Promise<void>; label?: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const run = async () => {
    setState('saving');
    setMsg('');
    try {
      await onSave();
      setState('saved');
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 3000);
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="button"
        onClick={run}
        disabled={state === 'saving'}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-extrabold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-60"
      >
        <Save aria-hidden size={14} /> {state === 'saving' ? 'Saving…' : label}
      </button>
      {state === 'saved' && (
        <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green px-3 py-2 text-[11px] font-bold text-tm-green-deep">
          Saved.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="rounded-xl border border-tm-red/30 bg-tm-tint-red px-3 py-2 text-[11px] font-bold text-tm-red">
          {msg}
        </p>
      )}
    </div>
  );
}
