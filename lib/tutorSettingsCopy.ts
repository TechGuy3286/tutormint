// lib/tutorSettingsCopy.ts
//
// Every visible string for the tutor Settings redesign (PR62), English with its
// Urdu underneath, plus the per-card status vocabulary. It is ALL here, in one
// place, so the copy — English and Urdu both — can be corrected later without
// touching the page.
//
// PRESENTATION ONLY. Nothing here reads or writes data; it is words and class
// names. Who is listed, badges, Browse, search, sitemap and indexing are decided
// elsewhere and are unchanged.

import type { TileTone } from '@/lib/tileTones'

// The same Urdu font stack as the Membership Plans box (PR59) and the PR60 status
// card, so the Urdu reads the same everywhere.
export const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

// The state a card is in. 'neutral' is for the account cards (name, password),
// which make no completed/missing claim.
export type CardStatus = 'completed' | 'missing' | 'waiting' | 'rejected' | 'neutral'

type Bilingual = { en: string; ur: string }

// The badge + card styling for each status. A 'waiting' item (uploaded, not yet
// reviewed) reads navy, distinct from red 'missing'; 'rejected' is red and shows
// the reason. `tone` is the tinted-tile colour used once the page is in tile mode.
export const STATUS_META: Record<
  CardStatus,
  { badge: Bilingual | null; card: string; badgeCls: string; tone: TileTone }
> = {
  completed: {
    badge: { en: 'Completed', ur: 'مکمل' },
    card: 'border-tm-green-deep/30 bg-tm-tint-green',
    badgeCls: 'bg-tm-green-deep text-white',
    tone: 'green',
  },
  missing: {
    badge: { en: 'Missing', ur: 'باقی ہے' },
    card: 'border-tm-red/30 bg-tm-tint-red',
    badgeCls: 'bg-tm-red text-white',
    tone: 'red',
  },
  waiting: {
    badge: { en: 'Waiting for approval', ur: 'منظوری کا انتظار' },
    card: 'border-tm-navy/20 bg-tm-tint-navy',
    badgeCls: 'bg-tm-navy text-white',
    tone: 'navy',
  },
  rejected: {
    badge: { en: 'Rejected', ur: 'مسترد' },
    card: 'border-tm-red/40 bg-tm-tint-red',
    badgeCls: 'bg-tm-red text-white',
    tone: 'red',
  },
  neutral: {
    badge: null,
    card: 'border-gray-200 bg-white',
    badgeCls: '',
    tone: 'navy',
  },
}

export const SECTIONS = {
  step1: {
    title: { en: 'Step 1 — Required', ur: 'پہلا مرحلہ — ضروری' },
    // {done} and {total} are replaced at render.
    count: { en: 'Step 1: {done} of {total} done', ur: 'پہلا مرحلہ: {total} میں سے {done} مکمل' },
  },
  step2: {
    title: { en: 'Step 2 — Optional', ur: 'دوسرا مرحلہ — اختیاری' },
    count: { en: 'Step 2: {done} of {total} done', ur: 'دوسرا مرحلہ: {total} میں سے {done} مکمل' },
  },
  account: {
    title: { en: 'Account', ur: 'اکاؤنٹ' },
    count: null,
  },
} as const

// Card titles and one-line hints, English + Urdu, keyed by card. The page owns
// the form body of each; this owns the words around it.
export const CARDS: Record<string, { title: Bilingual; hint?: Bilingual }> = {
  mobile: {
    title: { en: 'Mobile number', ur: 'موبائل نمبر' },
    hint: { en: 'Verified by a code we send you.', ur: 'ایک کوڈ کے ذریعے تصدیق شدہ۔' },
  },
  cnic: {
    title: { en: 'CNIC (number and pictures)', ur: 'شناختی کارڈ (نمبر اور تصویریں)' },
    hint: { en: 'Kept private and checked by our team.', ur: 'نجی رکھا جاتا ہے اور ہماری ٹیم جانچتی ہے۔' },
  },
  profilePic: {
    title: { en: 'Profile picture', ur: 'پروفائل تصویر' },
    hint: { en: 'This is what parents see.', ur: 'یہی والدین کو نظر آتی ہے۔' },
  },
  selfie: {
    title: { en: 'Selfie', ur: 'سیلفی' },
    hint: { en: 'Held for verification only, never shown.', ur: 'صرف تصدیق کے لیے، کبھی دکھائی نہیں جاتی۔' },
  },
  subjects: {
    title: { en: 'Subjects you teach', ur: 'آپ کے پڑھائے جانے والے مضامین' },
    hint: { en: 'Search or pick from the grades with the most tuitions.', ur: 'تلاش کریں یا سب سے زیادہ ٹیوشن والی جماعتوں میں سے چنیں۔' },
  },
  location: {
    title: { en: 'Where you teach', ur: 'آپ کہاں پڑھاتے ہیں' },
    hint: { en: 'Your city and area.', ur: 'آپ کا شہر اور علاقہ۔' },
  },
  fee: {
    title: { en: 'Verification fee', ur: 'تصدیق کی فیس' },
    hint: { en: 'A one-time fee to verify your profile.', ur: 'آپ کی پروفائل کی تصدیق کے لیے ایک بار کی فیس۔' },
  },
  jobType: {
    title: { en: 'Job type', ur: 'کام کی قسم' },
    hint: { en: 'Choose every title that fits you.', ur: 'ہر وہ عنوان چنیں جو آپ پر پورا اترے۔' },
  },
  availability: {
    title: { en: 'When you are available', ur: 'آپ کب دستیاب ہیں' },
    hint: { en: 'The days and times you can teach.', ur: 'وہ دن اور اوقات جب آپ پڑھا سکتے ہیں۔' },
  },
  degrees: {
    title: { en: 'Degrees', ur: 'ڈگریاں' },
    hint: { en: 'Your certificate images stay private.', ur: 'آپ کی سند کی تصویریں نجی رہتی ہیں۔' },
  },
  certifications: {
    title: { en: 'Certifications', ur: 'اسناد' },
    hint: { en: 'Optional. Same private treatment as your degrees.', ur: 'اختیاری۔ ڈگریوں جیسا ہی نجی سلوک۔' },
  },
  experience: {
    title: { en: 'Experience', ur: 'تجربہ' },
    hint: { en: 'How many years you have taught.', ur: 'آپ نے کتنے سال پڑھایا ہے۔' },
  },
  email: {
    title: { en: 'Email', ur: 'ای میل' },
    hint: { en: 'For receipts and reminders.', ur: 'رسیدوں اور یاد دہانیوں کے لیے۔' },
  },
  video: {
    title: { en: 'Introduction video', ur: 'تعارفی ویڈیو' },
    hint: { en: 'A short clip showing how you teach.', ur: 'ایک مختصر ویڈیو جو آپ کا پڑھانے کا انداز دکھائے۔' },
  },
  details: {
    title: { en: 'Your name and WhatsApp', ur: 'آپ کا نام اور واٹس ایپ' },
  },
  password: {
    title: { en: 'Change password', ur: 'پاس ورڈ تبدیل کریں' },
    hint: { en: 'Update your account password.', ur: 'اپنا اکاؤنٹ پاس ورڈ تبدیل کریں۔' },
  },
}

// Read-only status lines (fee, experience) — the item is done elsewhere, so the
// card only shows where it stands and a link to the right place.
export const READONLY_LINES: Record<string, { done: Bilingual; todo: Bilingual; cta: Bilingual }> = {
  fee: {
    done: { en: 'Your verification fee is paid.', ur: 'آپ کی تصدیق کی فیس ادا ہو چکی ہے۔' },
    todo: { en: 'Your verification fee is not paid yet.', ur: 'آپ کی تصدیق کی فیس ابھی ادا نہیں ہوئی۔' },
    cta: { en: 'Go to verification', ur: 'تصدیق کی طرف جائیں' },
  },
  experience: {
    done: { en: 'Your experience is added.', ur: 'آپ کا تجربہ شامل ہو چکا ہے۔' },
    todo: { en: 'Add how many years you have taught.', ur: 'شامل کریں کہ آپ نے کتنے سال پڑھایا ہے۔' },
    cta: { en: 'Add experience', ur: 'تجربہ شامل کریں' },
  },
  email: {
    done: { en: 'Your email is added and verified.', ur: 'آپ کی ای میل شامل اور تصدیق شدہ ہے۔' },
    todo: { en: 'Add and verify your email below.', ur: 'نیچے اپنی ای میل شامل اور تصدیق کریں۔' },
    cta: { en: '', ur: '' },
  },
}
