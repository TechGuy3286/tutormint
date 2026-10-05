"use client";

import FileUpload from '@/components/FileUpload';
import PhotoCaptureTile from '@/components/tutor/PhotoCaptureTile';
import { compressUnder1MB } from '@/lib/imageCompress';
import PasswordInput from '@/components/ui/PasswordInput'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'

import Avatar from '@/components/Avatar'
import Link from 'next/link'
import {
  X, Plus, Save, ArrowLeft, ArrowRight, BadgeCheck, ShieldAlert,
  Smartphone, CreditCard, Image as ImageIcon, Camera, BookOpen, MapPin, ShieldCheck,
  GraduationCap, Award, Briefcase, Mail, Tags, CalendarDays, Lock, UserRound, Wallet,
} from 'lucide-react'
import IdentityCard from '@/components/identity/IdentityCard'
import { StatusCard, StepHeader, SettingsTile, Urdu } from '@/components/tutor/SettingsPieces'
import { READONLY_LINES, type CardStatus } from '@/lib/tutorSettingsCopy'
import { FEE_MIN_DEFAULT, FEE_MAX_DEFAULT, validateFeeRange, feeLabelOf } from '@/lib/fee'
import { FormChecklist, ChecklistStatus } from '@/components/forms/FormChecklist'
import { checklistReady, type ChecklistItem } from '@/lib/formChecklist'
import type { DocumentStatuses, DocState } from '@/lib/tutorDocuments'
import { labelsForMasterIds } from '@/lib/taxonomy'
import { L } from '@/lib/onboarding/copy'
import TimeSlotGrid from '@/components/forms/TimeSlotGrid'
import { availabilityToSlots, slotsToAvailabilityList, formatSlots, type DaySlot } from '@/lib/timeSlots'
import SubjectLevelEditor from '@/components/tutor/SubjectLevelEditor'
import TutorCitiesEditor, { type CitiesState } from '@/components/tutor/TutorCitiesEditor'
import CredentialEditor, { type Credential } from '@/components/tutor/CredentialEditor'
import { parseCredential, serializeCredential } from '@/lib/degrees'
import EmailCard from '@/components/account/EmailCard'
import type { Identity } from '@/lib/identity'
import { formatPkMobile, isSyntheticEmail, normalisePkMobile } from '@/lib/phone'
import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'
import { reportSilentFailure } from '@/lib/silentFailure'

// PR17 §3.2 — a verified number is changed through support (client-safe constant).
const mobileSupportHref = whatsappHref(
  SUPPORT_WHATSAPP_FALLBACK,
  'Assalam-o-Alaikum, I need to change the mobile number on my TutorMint account.',
)
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { formatName } from '@/lib/formatName'
import { TextLinesSkeleton } from '@/components/Skeletons'

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
  // Monthly fee range (PR67) — the two fields, prefilled from the saved values.
  const [feeMin, setFeeMin] = useState("");
  const [feeMax, setFeeMax] = useState("");
  // Multiple areas (PR68). `areas` is the flattened list (status/summary/lock).
  const [areas, setAreas] = useState<string[]>([]);
  // PR85: up to 2 cities each with areas. `initialLoc` seeds the editor;
  // `locState` is the editor's live state, sent on save.
  const [initialLoc, setInitialLoc] = useState<{ cities: string[]; areasByCity: Record<string, string[]> }>({ cities: [], areasByCity: {} });
  const [locState, setLocState] = useState<CitiesState | null>(null);
  const [realEmail, setRealEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  // Tile mode (once every Step 2 item is done): which card's form is open.
  const [openCard, setOpenCard] = useState<string | null>(null);
  // PR77: scroll the tile that just expanded into view.
  const openTileRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (openCard && openTileRef.current) {
      openTileRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [openCard]);

  // Collapse-after-save (PR63 §C2): which collapsible cards are being edited. A
  // card with a saved value is shown collapsed (summary + Edit) until its key is
  // here; saving removes it again. Empty cards are never collapsed.
  const [editing, setEditing] = useState<Set<string>>(new Set());
  // Subject labels for the collapsed subjects summary (resolved from ids).
  const [subjectLabels, setSubjectLabels] = useState<string[]>([]);

  // Read-only verified mobile (PR 3b §2.2), from profiles.
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);

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
  // "Show my picture to parents" (PR70). Default on; read tolerantly from the
  // select('*') load so a not-yet-applied migration means "shown".
  const [showAvatar, setShowAvatar] = useState(true);

  // Subjects are the tutor's taxonomy_master ids. `subjectIds` is the FINAL set
  // to save (the merge output); `existingSubjectIds` is the IMMUTABLE saved
  // baseline the level-first editor merges against (PR84), refreshed only after
  // a successful save.
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [existingSubjectIds, setExistingSubjectIds] = useState<number[]>([]);

  // Job-type demand, so the chips order by how much work each title has (§2.3).
  const [jobTypeDemand, setJobTypeDemand] = useState<Record<string, number>>({});

  // PR73 §A: availability is a list of day+slot pairs, edited with the shared grid.
  const [availabilityList, setAvailabilityList] = useState<DaySlot[]>([]);

  const [degrees, setDegrees] = useState<Credential[]>([]);
  const [certifications, setCertifications] = useState<Credential[]>([]);
  // PR106-B §11: paused degrees (from the onboarding editor) are NOT shown or
  // edited here, but are carried forward verbatim on save so they stay paused and
  // are never brought back. Kept as their raw stored elements.
  const [pausedDegrees, setPausedDegrees] = useState<unknown[]>([]);


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

  // Subject labels for the collapsed subjects summary (PR63 §C2), resolved from
  // the saved master ids. Read-only.
  useEffect(() => {
    let live = true;
    if (subjectIds.length === 0) {
      setSubjectLabels([]);
      return;
    }
    labelsForMasterIds(subjectIds)
      .then((ls) => {
        if (live) setSubjectLabels(ls);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [subjectIds]);

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

      const [{ data: prof }, { data: tp }, { data: subjRows }] = await Promise.all([
        supabase.from('profiles').select('phone_number, phone_verified_at, email, email_verified, whatsapp').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      ]);

      setPhoneNumber((prof?.phone_number as string) || "");
      setPhoneVerified(Boolean(prof?.phone_verified_at));

      // PR74 §C1: the confirmed state comes from the AUTH user (what EmailCard
      // shows), not profiles.email_verified, which can lag. A signed-in account
      // with a real (non-synthetic) email has confirmed it.
      const authEmail = user.email || "";
      const real = isSyntheticEmail(authEmail) ? "" : authEmail;
      setRealEmail(real);
      setEmailVerified(real !== "");
      setFeePaid(Boolean(tp?.verified_fee_paid_at));
      setExperienceYears(
        typeof tp?.experience_years === 'number' ? (tp.experience_years as number) : null,
      );
      const savedMin = (tp?.fee_min_pkr as number | null) ?? (tp?.hourly_rate_pkr as number | null);
      const savedMax = (tp?.fee_max_pkr as number | null) ?? (tp?.hourly_rate_pkr as number | null);
      setFeeMin(String(savedMin ?? FEE_MIN_DEFAULT));
      setFeeMax(String(savedMax ?? FEE_MAX_DEFAULT));

      // Areas (PR68/PR85): the tutor_areas list grouped by city (up to 2 cities).
      try {
        const { data: areaRows } = await supabase
          .from('tutor_areas')
          .select('city, area')
          .eq('tutor_id', user.id)
          .order('created_at');
        const mainCity = ((tp?.city as string) || '').trim();
        const abc: Record<string, string[]> = {};
        const order: string[] = [];
        for (const r of areaRows ?? []) {
          const c = ((r.city as string) || '').trim() || mainCity;
          const a = ((r.area as string) || '').trim();
          if (!c || !a) continue;
          if (!abc[c]) { abc[c] = []; order.push(c); }
          if (!abc[c].includes(a)) abc[c].push(a);
        }
        const cities = [mainCity, ...order.filter((c) => c.toLowerCase() !== mainCity.toLowerCase())].filter(Boolean);
        const flat = Object.values(abc).flat();
        setInitialLoc({ cities: cities.length > 0 ? cities : mainCity ? [mainCity] : [], areasByCity: abc });
        setAreas(flat.length > 0 ? flat : tp?.area ? [tp.area as string] : []);
      } catch {
        setInitialLoc({ cities: tp?.city ? [tp.city as string] : [], areasByCity: {} });
        setAreas(tp?.area ? [tp.area as string] : []);
      }

      if (tp) {
        setFormData({
          fullName: tp.full_name || "",
          // PR86: profiles.whatsapp is canonical (onboarding + admin read it);
          // fall back to the legacy tutor_profiles.whatsapp_number.
          whatsapp: (prof?.whatsapp as string) || tp.whatsapp_number || "",
          // One city field for tutors: tutor_profiles.city is canonical (PR 3b §0).
          city: tp.city || "",
          areaName: tp.area || "",
          jobTypes: (tp.job_types as string[] | null) ?? [],
          profileImage: tp.avatar_url || "",
        });
        // Tolerant: `select('*')` simply omits show_avatar before the migration,
        // so undefined → shown (the default). Only an explicit false hides it.
        setShowAvatar((tp as { show_avatar?: boolean | null }).show_avatar !== false);

        const { data: selfieDoc } = await supabase
          .from('user_documents')
          .select('id')
          .eq('user_id', user.id)
          .eq('kind', 'selfie')
          .eq('status', 'active') // PR106-H3 §1.4
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selfieDoc) setSelfiePreviewUrl(`/api/documents/${selfieDoc.id}/preview`);

        setAvailabilityList(availabilityToSlots(tp.availability_list));

        // PR74 §B: decode every stored shape (plain, object, nested JSON) to
        // clean fields, so a corrupted degree is never re-wrapped on Save.
        // PR106-B §11: carry the onboarding docId through, and keep PAUSED degrees
        // out of the editor (preserved separately, re-appended on save).
        const asDegree = (d: unknown) => {
          const c = parseCredential(d);
          return { title: c.title, institute: c.institute, year: c.year, fileName: c.fileName, fileUrl: c.fileUrl, docId: c.docId || undefined };
        };
        const asCert = (c: unknown) => {
          const p = parseCredential(c);
          return { title: p.title, issuer: p.institute, year: p.year, fileName: p.fileName, fileUrl: p.fileUrl };
        };
        const rawDegrees = Array.isArray(tp.degrees) ? (tp.degrees as unknown[]) : [];
        setDegrees(rawDegrees.filter((d) => !parseCredential(d).paused).map(asDegree));
        setPausedDegrees(rawDegrees.filter((d) => parseCredential(d).paused));
        setCertifications(Array.isArray(tp.certifications) ? tp.certifications.map(asCert) : []);
      }

      {
        const loaded = (subjRows ?? []).map((r) => r.master_id as number);
        setSubjectIds(loaded);
        setExistingSubjectIds(loaded);
      }
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

  // Name is canonical on profiles.full_name (PR66 §5); write it there AND mirror
  // to tutor_profiles so admin / public profile / CV match the dashboard.
  const saveDetails = async () => {
    // PR86: WhatsApp is required, validated like the mobile.
    const wa = normalisePkMobile(formData.whatsapp);
    if (!wa) throw new Error('Add a valid WhatsApp number (Pakistani mobile format).');
    await tutorUpdate({ full_name: formatName(formData.fullName) });
    // PR86: WhatsApp is canonical on profiles.whatsapp (onboarding + admin read
    // it), stored normalised; the legacy whatsapp_number column is left as-is.
    const { error } = await supabase.from('profiles').update({ full_name: formatName(formData.fullName), whatsapp: wa }).eq('id', userId);
    if (error) throw new Error(error.message);
    setFormData((f) => ({ ...f, whatsapp: wa }));
  };

  const saveLocation = async () => {
    // PR85: up to 2 cities each with areas. The editor's live state is `locState`;
    // fall back to what was loaded if the editor has not reported yet.
    const s: CitiesState =
      locState ?? {
        mainCity: initialLoc.cities[0] ?? formData.city,
        cities: initialLoc.cities,
        areasByCity: initialLoc.areasByCity,
        valid: false,
      };
    if (!s.mainCity.trim()) {
      throw new Error('Add your main city — you are not shown to parents without it.');
    }
    if (!s.valid) {
      throw new Error('Add at least one area for every city you chose.');
    }
    await postProfileSave({ profile: { city: s.mainCity }, areasByCity: s.areasByCity });
    // Reflect the save locally so the summary/lock update without a reload.
    setFormData((f) => ({ ...f, city: s.mainCity }));
    setAreas(Object.values(s.areasByCity).flat());
    setInitialLoc({ cities: s.cities, areasByCity: s.areasByCity });
  };

  const saveJobTypes = () =>
    postProfileSave({ tutorProfile: { job_types: formData.jobTypes, teaching_mode: formData.jobTypes[0] ?? null } });

  const saveSubjects = async () => {
    await postProfileSave({ subjectMasterIds: subjectIds });
    // The just-saved set becomes the new baseline, so re-opening the editor
    // merges against what is actually stored (PR84).
    setExistingSubjectIds(subjectIds);
  };

  const saveAvailability = () => tutorUpdate({ availability_list: slotsToAvailabilityList(availabilityList) });
  // "Show my picture to parents" (PR70): flip immediately, write direct (RLS-scoped
  // to the tutor's own row). Tolerant of the not-yet-applied migration.
  const saveShowAvatar = async (value: boolean) => {
    setShowAvatar(value);
    try { await tutorUpdate({ show_avatar: value }); } catch { /* pre-migration or transient */ }
  };
  // PR106-B §11: write the active (edited) degrees PLUS the preserved paused ones
  // (re-serialised with paused:true), so a Settings save never resurrects or
  // rewrites a paused degree. docId on an active entry is carried through.
  const saveDegrees = () =>
    tutorUpdate({
      degrees: [
        ...degrees,
        ...pausedDegrees.map((d) => {
          const c = parseCredential(d);
          return serializeCredential({ title: c.title, docId: c.docId, paused: true });
        }),
      ],
    });
  const saveCertifications = () => tutorUpdate({ certifications });

  // Monthly fee range (PR67 §3): whole rupees, min ≤ max, saved to fee_min/fee_max.
  const parseFee = (s: string): number | null => {
    const digits = s.replace(/[^\d]/g, "");
    return digits === "" ? null : Number(digits);
  };
  const saveFee = async () => {
    const min = parseFee(feeMin);
    const max = parseFee(feeMax);
    const err = validateFeeRange(min, max);
    if (err) throw new Error(err.en);
    await postProfileSave({ tutorProfile: { fee_min_pkr: min, fee_max_pkr: max } });
  };

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

  // ---- PR63 §C2: collapse-after-save --------------------------------------
  const openEdit = (key: string) => setEditing((s) => new Set(s).add(key));
  const collapse = (key: string) => {
    setEditing((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    // PR76 §D.1: Settings is always a tile grid — a card's form opens in place
    // (openCard) and Save shrinks it back to its square tile.
    setOpenCard((o) => (o === key ? null : o));
  };

  const short = (parts: string[], keep = 2): string => {
    const kept = parts.slice(0, keep).join(', ');
    return parts.length > keep ? `${kept} +${parts.length - keep} more` : kept;
  };

  // Collapsed summaries — plain text shown when a card has a saved value.
  const detailsSummary = formData.fullName.trim();
  // PR85: "Lahore · DHA, Gulberg | Gujranwala · Model Town" (per city).
  const locSource =
    locState && locState.valid
      ? { cities: locState.cities, areasByCity: locState.areasByCity }
      : initialLoc;
  const locationSummary = locSource.cities.length
    ? locSource.cities.map((c) => `${c} · ${short(locSource.areasByCity[c] ?? [], 3)}`).join(' | ')
    : formData.city.trim();
  const subjectSummary = subjectLabels.length
    ? short(subjectLabels.map((l) => l.split(' — ').pop() ?? l))
    : subjectIds.length
      ? `${subjectIds.length} subjects`
      : '';
  const jobTypeSummary = formData.jobTypes.length ? short(formData.jobTypes) : '';
  const availabilitySummary = availabilityList.length
    ? formatSlots(availabilityList)
    : '';
  // PR74 §B: the plain line "BS Physics, Punjab University (2019)", never raw JSON.
  const credLine = (title: string, second: string, year: string) => {
    const head = [title, second].filter((x) => x && x.trim()).join(', ') || title.trim();
    return head && year.trim() ? `${head} (${year.trim()})` : head;
  };
  const degreesSummary = degrees.length
    ? short(degrees.map((d) => credLine(d.title, d.institute ?? '', d.year)).filter(Boolean)) || `${degrees.length} added`
    : '';
  const certsSummary = certifications.length
    ? short(certifications.map((c) => credLine(c.title, c.issuer ?? '', c.year)).filter(Boolean)) || `${certifications.length} added`
    : '';
  const feeSummary = feeLabelOf({ fee_min_pkr: parseFee(feeMin), fee_max_pkr: parseFee(feeMax) }) ?? '';

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
    formData.city.trim() && areas.length > 0 ? 'completed' : 'missing';
  const feeStatus: CardStatus = feePaid ? 'completed' : 'missing';

  // PR72 §E: field locks. Each mirrors the server trigger (migration 116).
  // mobile/CNIC/picture/selfie lock once verified/approved; subjects, city and
  // areas lock once ALL of step 1 is complete. The show-picture toggle stays
  // editable (rendered separately below).
  const step1Complete =
    mobileStatus === 'completed' &&
    cnicStatus === 'completed' &&
    profilePicStatus === 'completed' &&
    selfieStatus === 'completed' &&
    subjectsStatus === 'completed' &&
    locationStatus === 'completed';
  const subjectSummaryText = subjectLabels.length > 0 ? subjectLabels.join(', ') : '';
  const locationSummaryText = initialLoc.cities.length
    ? initialLoc.cities.map((c) => `${c}: ${(initialLoc.areasByCity[c] ?? []).join(', ')}`).join(' | ')
    : [formData.city, areas.join(', ')].filter(Boolean).join(' · ');

  const jobTypeStatus: CardStatus = formData.jobTypes.length > 0 ? 'completed' : 'missing';
  const availabilityStatus: CardStatus = availabilityList.length > 0 ? 'completed' : 'missing';
  const degreesStatus: CardStatus = degrees.length > 0 ? 'completed' : 'missing';
  const certsStatus: CardStatus = certifications.length > 0 ? 'completed' : 'missing';
  const experienceStatus: CardStatus = experienceYears && experienceYears > 0 ? 'completed' : 'missing';
  const feeMonthlyStatus: CardStatus = parseFee(feeMin) && parseFee(feeMax) ? 'completed' : 'missing';
  const emailStatus: CardStatus = realEmail && emailVerified ? 'completed' : 'missing';

  const step1Cards: CardDesc[] = [
    {
      key: 'mobile',
      status: mobileStatus,
      locked: mobileStatus === 'completed',
      lockedValue: phoneNumber ? formatPkMobile(phoneNumber) : 'Verified',
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
      locked: cnicStatus === 'completed',
      lockedValue: 'Verified',
      reason: statuses?.cnic.reason,
      bare: true,
      icon: <CreditCard size={20} aria-hidden />,
      body: identity ? (
        <IdentityCard identity={identity} role="tutor" />
      ) : (
        <TextLinesSkeleton lines={2} />
      ),
    },
    {
      key: 'profilePic',
      status: profilePicStatus,
      reason: statuses?.profilePic.reason,
      icon: <ImageIcon size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
          {/* PR72 §E: once the picture is approved it is locked — read-only, a
              lock note, no Change. The show-picture toggle below stays editable. */}
          {profilePicStatus === 'completed' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
                <Avatar name={formData.fullName} src={formData.profileImage || null} decorative ring="" className="h-14 w-14 rounded-xl text-lg" />
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500">
                  <Lock aria-hidden size={13} /> Approved
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-600">To change this, contact support.</p>
              <p className="text-[11px] leading-relaxed text-gray-600" lang="ur" dir="rtl">تبدیلی کے لیے سپورٹ سے رابطہ کریں۔</p>
            </div>
          ) : (
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
          )}
          {/* The picture/selfie instruction (PR70 §4). */}
          <div className="rounded-xl bg-tm-tint-navy p-3">
            <p className="text-[11px] leading-relaxed text-tm-navy">{L.pictureNote.en}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-tm-navy" lang="ur" dir="rtl">{L.pictureNote.ur}</p>
          </div>
          {/* "Show my picture to parents" toggle (PR70 §2). Default on; the tutor
              still sees their own photo above with a "Hidden from parents" note. */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <button
              type="button"
              role="switch"
              aria-checked={showAvatar}
              onClick={() => void saveShowAvatar(!showAvatar)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-tm-navy">{L.showAvatar.en}</span>
                <span className="block text-[11px] text-gray-500" lang="ur" dir="rtl">{L.showAvatar.ur}</span>
              </span>
              <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${showAvatar ? 'bg-tm-green-deep' : 'bg-gray-300'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${showAvatar ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
            </button>
            {!showAvatar && (
              <p className="mt-2 text-[11px] font-bold text-tm-gold-ink">
                {L.hiddenFromParents.en} — <span lang="ur" dir="rtl">{L.hiddenFromParents.ur}</span>
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'selfie',
      status: selfieStatus,
      locked: selfieStatus === 'completed',
      lockedValue: 'Approved',
      reason: statuses?.selfie.reason,
      icon: <Camera size={20} aria-hidden />,
      body: (
        <div className="space-y-1.5">
          {/* PR74 §C4: the full instruction lives on the profile-picture card;
              here, one line only. */}
          <p className="text-[11px] leading-relaxed text-gray-600">
            Only TutorMint’s verification team sees your selfie.
            <span lang="ur" dir="rtl" className="ms-1">آپ کی سیلفی صرف ٹیوٹرمنٹ کی تصدیقی ٹیم دیکھتی ہے۔</span>
          </p>
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
      locked: step1Complete,
      lockedValue: subjectSummaryText,
      icon: <BookOpen size={20} aria-hidden />,
      collapsible: true,
      summary: subjectSummary,
      body: (
        <div className="space-y-3">
          <SubjectLevelEditor existing={existingSubjectIds} onChange={setSubjectIds} />
          <SaveBar onSave={saveSubjects} onSaved={() => collapse('subjects')}
            items={[{ en: 'Choose at least one subject', ur: 'کم از کم ایک مضمون منتخب کریں', done: subjectIds.length > 0 }]} />
        </div>
      ),
    },
    {
      key: 'location',
      status: locationStatus,
      locked: step1Complete,
      lockedValue: locationSummaryText,
      icon: <MapPin size={20} aria-hidden />,
      collapsible: true,
      summary: locationSummary,
      body: (
        <div className="space-y-3">
          {/* PR85: up to 2 cities, each with its areas. */}
          <TutorCitiesEditor
            initialCities={initialLoc.cities}
            initialAreasByCity={initialLoc.areasByCity}
            onChange={setLocState}
          />
          <SaveBar onSave={saveLocation} onSaved={() => collapse('location')}
            items={[
              { en: 'Choose your main city', ur: 'اپنا مرکزی شہر منتخب کریں', done: !!(locState?.mainCity ?? initialLoc.cities[0] ?? '').trim() },
              { en: 'Add at least one area per city', ur: 'ہر شہر کے لیے کم از کم ایک علاقہ', done: locState ? locState.valid : areas.length > 0 },
            ]} />
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
      collapsible: true,
      summary: jobTypeSummary,
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
          <SaveBar onSave={saveJobTypes} onSaved={() => collapse('jobType')}
            items={[{ en: 'Choose at least one job type', ur: 'کم از کم ایک قسمِ کام منتخب کریں', done: formData.jobTypes.length > 0 }]} />
        </div>
      ),
    },
    {
      key: 'availability',
      status: availabilityStatus,
      icon: <CalendarDays size={20} aria-hidden />,
      collapsible: true,
      summary: availabilitySummary,
      body: (
        <div className="space-y-3">
          {/* PR73 §A: the shared 7×3 time-slot grid. */}
          <TimeSlotGrid value={availabilityList} onChange={setAvailabilityList} />
          <SaveBar onSave={saveAvailability} onSaved={() => collapse('availability')}
            items={[{ en: 'Pick at least one time you can teach', ur: 'کم از کم ایک وقت منتخب کریں جب آپ پڑھا سکیں', done: availabilityList.length > 0 }]} />
        </div>
      ),
    },
    {
      key: 'degrees',
      status: degreesStatus,
      icon: <GraduationCap size={20} aria-hidden />,
      collapsible: true,
      summary: degreesSummary,
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
          <SaveBar onSave={saveDegrees} onSaved={() => collapse('degrees')} />
        </div>
      ),
    },
    {
      key: 'certifications',
      status: certsStatus,
      icon: <Award size={20} aria-hidden />,
      collapsible: true,
      summary: certsSummary,
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
          <SaveBar onSave={saveCertifications} onSaved={() => collapse('certifications')} />
        </div>
      ),
    },
    {
      key: 'experience',
      status: experienceStatus,
      bare: true,
      icon: <Briefcase size={20} aria-hidden />,
      body:
        experienceYears && experienceYears > 0 ? (
          // PR74 §C3: show the value in plain text, e.g. "5 years".
          <div className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
            {experienceYears} {experienceYears === 1 ? 'year' : 'years'} of experience
          </div>
        ) : (
          <ReadonlyLine kind="experience" done={false} href="/tutor/complete-profile" />
        ),
    },
    {
      key: 'monthlyFee',
      status: feeMonthlyStatus,
      collapsible: true,
      summary: feeSummary,
      icon: <Wallet size={20} aria-hidden />,
      body: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] font-bold text-tm-navy">Minimum (Rs / month)</span>
              <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">کم از کم (روپے / ماہ)</span>
              <input
                inputMode="numeric"
                value={feeMin}
                onChange={(e) => setFeeMin(e.target.value)}
                placeholder={String(FEE_MIN_DEFAULT)}
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-bold text-tm-navy">Maximum (Rs / month)</span>
              <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">زیادہ سے زیادہ (روپے / ماہ)</span>
              <input
                inputMode="numeric"
                value={feeMax}
                onChange={(e) => setFeeMax(e.target.value)}
                placeholder={String(FEE_MAX_DEFAULT)}
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
            </label>
          </div>
          <SaveBar onSave={saveFee} onSaved={() => collapse('monthlyFee')}
            items={[
              { en: 'Enter your minimum monthly fee', ur: 'اپنی کم از کم ماہانہ فیس درج کریں', done: (parseFee(feeMin) ?? 0) > 0 },
              { en: 'Enter a maximum that is at least the minimum', ur: 'کم از کم کے برابر یا زیادہ حد درج کریں', done: validateFeeRange(parseFee(feeMin), parseFee(feeMax)) === null },
            ]} />
        </div>
      ),
    },
    {
      key: 'email',
      status: emailStatus,
      bare: true,
      icon: <Mail size={20} aria-hidden />,
      body: <EmailCard />,
    },
    // PR76 §D.2: the Intro video tile is removed from Settings (it is no longer a
    // completion item and is offered as an optional tile on the dashboard). It is
    // therefore out of the Step 2 count too, which is derived from this array.
  ];

  const accountCards: CardDesc[] = [
    {
      key: 'details',
      status: 'neutral',
      icon: <UserRound size={20} aria-hidden />,
      collapsible: true,
      summary: detailsSummary,
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
            <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">واٹس ایپ نمبر</span>
            <input
              type="tel"
              inputMode="tel"
              value={formData.whatsapp}
              onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
              placeholder="0300 1234567"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
            />
            {formData.whatsapp.trim() && !normalisePkMobile(formData.whatsapp) && (
              <span className="mt-1 block text-[11px] font-bold text-tm-red">Enter a valid Pakistani mobile number.</span>
            )}
          </label>
          <SaveBar onSave={saveDetails} onSaved={() => collapse('details')}
            items={[
              { en: 'Type your full name', ur: 'اپنا پورا نام لکھیں', done: formData.fullName.trim().length >= 2 },
              { en: 'Add your WhatsApp number', ur: 'اپنا واٹس ایپ نمبر شامل کریں', done: !!normalisePkMobile(formData.whatsapp) },
            ]} />
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

  // forceOpen: the expanded tile always shows its form (never the collapsed
  // summary). onClose renders the × that collapses it without saving (PR77).
  const renderCard = (c: CardDesc, forceOpen = false, onClose?: () => void) => (
    <StatusCard
      key={c.key}
      cardKey={c.key}
      status={c.status}
      reason={c.reason}
      bare={c.bare}
      summary={c.collapsible ? c.summary : undefined}
      open={c.collapsible ? forceOpen || editing.has(c.key) : true}
      onEdit={c.collapsible && !c.locked ? () => openEdit(c.key) : undefined}
      onClose={onClose}
      locked={c.locked}
      lockedValue={c.lockedValue}
    >
      {c.body}
    </StatusCard>
  );

  // PR83 (Part A.2): the tiles are a two-column grid, laid out in source order.
  // The tapped tile stays in its cell (highlighted); its expanded panel opens
  // full-width in the row DIRECTLY AFTER the tile's row. No grid-flow-row-dense
  // (its backfill was reordering the other tiles and dropping an odd-column
  // tile's panel a row below where it belonged). Only one is open at a time;
  // Save or the × shrinks it back.
  const renderTiles = (list: CardDesc[]) => {
    const rows: CardDesc[][] = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
    return (
      <ul className="grid grid-cols-2 gap-3">
        {rows.map((row, ri) => {
          const openInRow = row.find((c) => c.key === openCard);
          return (
            <Fragment key={ri}>
              {row.map((c) => (
                <li key={c.key}>
                  <SettingsTile
                    cardKey={c.key}
                    status={c.status}
                    icon={c.icon}
                    locked={c.locked}
                    open={openCard === c.key}
                    onClick={() => (openCard === c.key ? collapse(c.key) : setOpenCard(c.key))}
                  />
                </li>
              ))}
              {openInRow && (
                <li ref={openTileRef} className="col-span-2 scroll-mt-4">
                  {renderCard(openInRow, true, () => collapse(openInRow.key))}
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    );
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6 font-sans text-slate-700 sm:px-6">
      {/* PR63 §C1: the breadcrumb and "View your public profile" are removed
          (both live on the dashboard); a single Back link remains. */}
      <Link
        href="/tutor/dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-navy hover:underline"
      >
        <ArrowLeft aria-hidden size={14} /> Back to Tutor dashboard
      </Link>

      {/* PR76 §D.1: every section is a two-column grid of equal square tiles.
          Tapping a tile expands it in place to its full-width form; Save (or
          tapping the tile again) shrinks it back. */}
      {/* Step 1 — required. */}
      <section className="space-y-3">
        <StepHeader section="step1" done={step1Done} total={step1Cards.length} />
        {renderTiles(step1Cards)}
      </section>

      {/* Step 2 — optional. */}
      <section className="space-y-3">
        <StepHeader section="step2" done={step2Done} total={step2Cards.length} />
        {renderTiles(step2Cards)}
      </section>

      {/* Account — name, WhatsApp and password. Tiles too (§D.1). */}
      <section className="space-y-3">
        <StepHeader section="account" />
        {renderTiles(accountCards)}
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
  /** PR63 §C2: this card collapses to a summary + Edit once it has a value. */
  collapsible?: boolean;
  /** The collapsed plain-text value; empty means the form stays open. */
  summary?: string;
  /** PR72 §E: the field is locked — read-only, lock icon, no Edit. */
  locked?: boolean;
  lockedValue?: string | null;
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
function SaveBar({
  onSave,
  onSaved,
  label = 'Save',
  items,
}: {
  onSave: () => Promise<void>;
  /** Called after a successful save — used to collapse the card (PR63 §C2). */
  onSaved?: () => void;
  label?: string;
  /** PR80: the self-explaining required parts. When given, they render as a
   *  numbered checklist above and a "what's missing / ready" line below, and the
   *  Save button is disabled until every required part is done. Omitted → no gate
   *  (single-obvious-action cards keep the plain bar). */
  items?: ChecklistItem[];
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const ready = !items || checklistReady(items);
  const run = async () => {
    setState('saving');
    setMsg('');
    try {
      await onSave();
      setState('saved');
      onSaved?.();
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 3000);
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  return (
    <div className="space-y-2 pt-1">
      {items && items.length > 0 && <FormChecklist items={items} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state === 'saving' || !ready}
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
      {items && items.length > 0 && <ChecklistStatus items={items} />}
    </div>
  );
}
