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
import {
  X, Plus, Save, ArrowRight, BadgeCheck, ShieldAlert,
  Smartphone, CreditCard, Image as ImageIcon, Camera, BookOpen, MapPin, ShieldCheck,
  GraduationCap, Award, Briefcase, Mail, Tags, CalendarDays, Video, Lock, UserRound,
} from 'lucide-react'
import IdentityCard from '@/components/identity/IdentityCard'
import { StatusCard, StepHeader, SettingsTile, Urdu } from '@/components/tutor/SettingsPieces'
import { READONLY_LINES, type CardStatus } from '@/lib/tutorSettingsCopy'
import type { DocumentStatuses, DocState } from '@/lib/tutorDocuments'
import SubjectPicker from '@/components/tutor/SubjectPicker'
import VideoUpload from '@/components/tutor/VideoUpload'
import CredentialEditor, { type Credential } from '@/components/tutor/CredentialEditor'
import PublicPageStatus from '@/components/tutor/PublicPageStatus'
import EmailCard from '@/components/account/EmailCard'
import type { Identity } from '@/lib/identity'
import { formatPkMobile, isSyntheticEmail } from '@/lib/phone'
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
// card and the video persist on their own action (upload / submit / save), so
// they carry no separate Save.
//
// PR62 — the cards are GROUPED into Step 1 (required) and Step 2 (optional), each
// with a simple count, and each card shows its own state (Completed / Missing /
// Waiting for approval / Rejected) with Urdu underneath. Once every Step 2 item
// is complete the page becomes a two-column tile grid (tap a tile to edit that
// card). This is PRESENTATION ONLY: every save/write path, API route, validation
// and permission is exactly as before, and nothing here changes who is listed,
// badges, Browse, search, sitemap or indexing.

export default function TutorSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { map: cityMap } = useCityAreas();
  const { titles: jobTitles } = useJobTitles();
  const [tutorEmail, setTutorEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);

  // PR62 — read-only signals for the per-card status badges. None of these are
  // written here; they only decide green / red / waiting on each card.
  const [statuses, setStatuses] = useState<DocumentStatuses | null>(null);
  const [feePaid, setFeePaid] = useState(false);
  const [experienceYears, setExperienceYears] = useState<number | null>(null);
  const [realEmail, setRealEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  // Tile mode (once every Step 2 item is done): which card's form is open.
  const [openCard, setOpenCard] = useState<string | null>(null);

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
    // Approval statuses for CNIC / profile picture / selfie (PR60), read-only —
    // the same source the old status card used, now folded into each card.
    fetch('/api/tutor/document-status', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j) setStatuses(j as DocumentStatuses);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const reloadStatuses = async () => {
    try {
      const r = await fetch('/api/tutor/document-status', { headers: { accept: 'application/json' } });
      if (r.ok) setStatuses((await r.json()) as DocumentStatuses);
    } catch {
      /* leave as-is */
    }
  };

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
        supabase.from('profiles').select('phone_number, phone_verified_at, email, email_verified').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
        supabase.from('tutor_directory').select('id').eq('id', user.id).maybeSingle(),
      ]);

      setPhoneNumber((prof?.phone_number as string) || "");
      setPhoneVerified(Boolean(prof?.phone_verified_at));
      setPublicSlug((tp?.slug as string) || "");
      setPublicListed(Boolean(dir));

      // A synthetic <msisdn>@users.tutormint.org address is not one the tutor
      // chose — it reads as "no email yet".
      const rawEmail = (prof?.email as string) || user.email || "";
      setRealEmail(isSyntheticEmail(rawEmail) ? "" : rawEmail);
      setEmailVerified(Boolean(prof?.email_verified));
      setFeePaid(Boolean(tp?.verified_fee_paid_at));
      setExperienceYears(
        typeof tp?.experience_years === 'number' ? (tp.experience_years as number) : null,
      );

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
        void reloadStatuses();
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
      if (res.ok && data?.previewUrl) { setSelfiePreviewUrl(data.previewUrl); void reloadStatuses(); }
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

  // ---- PR62: per-card status (read-only; presentation only) ---------------
  // Maps a document approval state (CNIC / profile picture / selfie) to a card
  // status. An item uploaded but not yet reviewed reads "Waiting for approval".
  const docCard = (st: DocState | undefined, hasUploadOverride: boolean): CardStatus => {
    if (!st) return hasUploadOverride ? 'waiting' : 'missing';
    if (st.status === 'approved') return 'completed';
    if (st.status === 'rejected') return 'rejected';
    if (st.status === 'pending') return 'waiting';
    return st.hasUpload || hasUploadOverride ? 'waiting' : 'missing';
  };

  const mobileStatus: CardStatus = phoneVerified ? 'completed' : 'missing';
  const cnicStatus: CardStatus = docCard(statuses?.cnic, false);
  const profilePicStatus: CardStatus = docCard(statuses?.profilePic, !!formData.profileImage);
  const selfieStatus: CardStatus = docCard(statuses?.selfie, !!selfiePreviewUrl);
  const subjectsStatus: CardStatus = subjectIds.length > 0 ? 'completed' : 'missing';
  const locationStatus: CardStatus =
    formData.city.trim() && formData.areaName.trim() ? 'completed' : 'missing';
  const feeStatus: CardStatus = feePaid ? 'completed' : 'missing';

  const jobTypeStatus: CardStatus = formData.jobTypes.length > 0 ? 'completed' : 'missing';
  const availabilityStatus: CardStatus = availabilityList.length > 0 ? 'completed' : 'missing';
  const degreesStatus: CardStatus = degrees.length > 0 ? 'completed' : 'missing';
  const certsStatus: CardStatus = certifications.length > 0 ? 'completed' : 'missing';
  const experienceStatus: CardStatus = experienceYears && experienceYears > 0 ? 'completed' : 'missing';
  const emailStatus: CardStatus = realEmail && emailVerified ? 'completed' : 'missing';
  const videoStatusCard: CardStatus =
    videoStatus === 'approved'
      ? 'completed'
      : videoStatus === 'rejected'
        ? 'rejected'
        : videoStatus === 'uploaded' || videoStatus === 'pending'
          ? 'waiting'
          : 'missing';

  const step1Cards: CardDesc[] = [
    {
      key: 'mobile',
      status: mobileStatus,
      icon: <Smartphone size={20} aria-hidden />,
      body: (
        <div className="space-y-1">
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
      ),
    },
    {
      key: 'cnic',
      status: cnicStatus,
      reason: statuses?.cnic.reason,
      bare: true,
      icon: <CreditCard size={20} aria-hidden />,
      body: identity ? (
        <IdentityCard identity={identity} role="tutor" />
      ) : (
        <p className="text-[11px] text-gray-500">Loading…</p>
      ),
    },
    {
      key: 'profilePic',
      status: profilePicStatus,
      reason: statuses?.profilePic.reason,
      icon: <ImageIcon size={20} aria-hidden />,
      body: (
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
      ),
    },
    {
      key: 'selfie',
      status: selfieStatus,
      reason: statuses?.selfie.reason,
      icon: <Camera size={20} aria-hidden />,
      body: (
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
      ),
    },
    {
      key: 'subjects',
      status: subjectsStatus,
      icon: <BookOpen size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
          <SubjectPicker value={subjectIds} onChange={setSubjectIds} />
          <SaveBar onSave={saveSubjects} />
        </div>
      ),
    },
    {
      key: 'location',
      status: locationStatus,
      icon: <MapPin size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'fee',
      status: feeStatus,
      bare: true,
      icon: <ShieldCheck size={20} aria-hidden />,
      body: <ReadonlyLine kind="fee" done={feePaid} href="/tutor/verify" />,
    },
  ];

  const step2Cards: CardDesc[] = [
    {
      key: 'jobType',
      status: jobTypeStatus,
      icon: <Tags size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'availability',
      status: availabilityStatus,
      icon: <CalendarDays size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'degrees',
      status: degreesStatus,
      icon: <GraduationCap size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'certifications',
      status: certsStatus,
      icon: <Award size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'experience',
      status: experienceStatus,
      bare: true,
      icon: <Briefcase size={20} aria-hidden />,
      body: (
        <ReadonlyLine
          kind="experience"
          done={!!(experienceYears && experienceYears > 0)}
          href="/tutor/complete-profile"
        />
      ),
    },
    {
      key: 'email',
      status: emailStatus,
      bare: true,
      icon: <Mail size={20} aria-hidden />,
      body: <EmailCard />,
    },
    {
      key: 'video',
      status: videoStatusCard,
      icon: <Video size={20} aria-hidden />,
      body: (
        <VideoUpload
          initialAttempts={videoAttempts}
          initialStatus={videoStatus}
          onSubmitted={() => void loadTutorProfile()}
        />
      ),
    },
  ];

  const accountCards: CardDesc[] = [
    {
      key: 'details',
      status: 'neutral',
      icon: <UserRound size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
    {
      key: 'password',
      status: 'neutral',
      icon: <Lock size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
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
        </div>
      ),
    },
  ];

  const step1Done = step1Cards.filter((c) => c.status === 'completed').length;
  const step2Done = step2Cards.filter((c) => c.status === 'completed').length;
  // Tile mode once every Step 2 item is complete (owner PR62 §4).
  const tileMode = step2Cards.length > 0 && step2Done === step2Cards.length;

  const renderCard = (c: CardDesc) => (
    <StatusCard key={c.key} cardKey={c.key} status={c.status} reason={c.reason} bare={c.bare}>
      {c.body}
    </StatusCard>
  );

  const renderTiles = (list: CardDesc[]) => (
    <>
      <ul className="grid grid-cols-2 gap-3">
        {list.map((c) => (
          <li key={c.key}>
            <SettingsTile
              cardKey={c.key}
              status={c.status}
              icon={c.icon}
              open={openCard === c.key}
              onClick={() => setOpenCard(openCard === c.key ? null : c.key)}
            />
          </li>
        ))}
      </ul>
      {list
        .filter((c) => openCard === c.key)
        .map((c) => (
          <div key={`open-${c.key}`}>{renderCard(c)}</div>
        ))}
    </>
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6 font-sans text-slate-700 sm:px-6">
      <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Settings' }]} />

      {/* The tutor's public page (§3.1/§3.2): "View your public profile" when
          listed, or the not-live preview when not. Kept at the top (PR61/PR62). */}
      {publicSlug && <PublicPageStatus slug={publicSlug} listed={publicListed} />}

      {/* Step 1 — required. */}
      <section className="space-y-3">
        <StepHeader section="step1" done={step1Done} total={step1Cards.length} />
        {tileMode ? renderTiles(step1Cards) : step1Cards.map(renderCard)}
      </section>

      {/* Step 2 — optional. */}
      <section className="space-y-3">
        <StepHeader section="step2" done={step2Done} total={step2Cards.length} />
        {tileMode ? renderTiles(step2Cards) : step2Cards.map(renderCard)}
      </section>

      {/* Account — name, WhatsApp and password. Not part of the two steps. */}
      <section className="space-y-3">
        <StepHeader section="account" />
        {accountCards.map(renderCard)}
      </section>
    </main>
  );
}

// A card descriptor: its key (into the copy table), its computed status, an
// optional reject reason and icon, whether the body is already a self-contained
// card (bare), and the form body the page owns.
type CardDesc = {
  key: string;
  status: CardStatus;
  reason?: string | null;
  bare?: boolean;
  icon: React.ReactNode;
  body: React.ReactNode;
};

// A read-only status line (verification fee, experience): the item is completed
// elsewhere, so the card only reports where it stands and links to the right
// place. It writes nothing.
function ReadonlyLine({ kind, done, href }: { kind: 'fee' | 'experience'; done: boolean; href: string }) {
  const l = READONLY_LINES[kind];
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-700">{done ? l.done.en : l.todo.en}</p>
      <Urdu className="text-[11px] font-semibold text-gray-700">{done ? l.done.ur : l.todo.ur}</Urdu>
      {!done && l.cta.en && (
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-tm-navy/30 px-4 text-xs font-bold text-tm-navy transition-colors hover:bg-tm-tint-navy"
        >
          {l.cta.en} <ArrowRight aria-hidden size={14} />
        </Link>
      )}
    </div>
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
