// lib/contentQueue/careerTopics.ts
//
// The evergreen TUTOR CAREER topics the content queue carries (owner, 6 Oct
// 2026): the queue is to be ≈40% tutor-career, and no search signal produces
// enough of those on its own, so they come from this fixed list. PURE — no
// imports — so the nightly build, the admin screen and the tests read one list.
//
// Every title is distinct in SHAPE, not a city/grade/subject variant of another
// (the dedupe rule would drop a variant). None of the notes carries a number, so
// a draft written from them passes the figure gate; the notes are guidance for
// the writer, not facts to publish.

import type { Candidate } from './core'

export type CareerTopic = { slug: string; title: string; notes: string }

export const CAREER_TOPICS: CareerTopic[] = [
  {
    slug: 'become-home-tutor',
    title: 'How to become a home tutor in Pakistan: a step-by-step start',
    notes: 'Cover what a new tutor needs before the first family: the subjects to offer, how to present qualifications honestly, verification on TutorMint, and how the first conversation with a parent goes. No fee figures.',
  },
  {
    slug: 'set-your-fee',
    title: 'Setting your tuition fee as a new tutor: what to think about before you quote',
    notes: 'Explain the factors (level taught, travel, hours, group vs one-to-one, the area) and how to talk about money with a parent. Describe ranges in words only — never a specific amount.',
  },
  {
    slug: 'online-tutoring-setup',
    title: 'Online tutoring from Pakistan: the setup, the platforms and your first lesson',
    notes: 'Camera, microphone, a quiet space, a shared whiteboard, how to run a first online lesson and keep a young student engaged. Mention that an online tutor on TutorMint reaches families in other cities.',
  },
  {
    slug: 'tutor-profile-that-reads',
    title: 'Writing a tutor profile that parents actually read',
    notes: 'The tagline, the about section, which subjects and levels to list, a clear photo, and why specifics beat adjectives. What a parent scans for first.',
  },
  {
    slug: 'first-demo-lesson',
    title: 'Your first demo lesson: how to prepare and what parents look for',
    notes: 'How to plan a short demo lesson, what to bring, how to involve the student and the parent, and how to follow up afterwards. A demo is a demo lesson, never called free.',
  },
  {
    slug: 'first-tuition-no-experience',
    title: 'How to get your first tuition when you have no teaching experience yet',
    notes: 'University students and fresh graduates: what counts as experience, how to show subject strength, applying to open tuitions on TutorMint, and being realistic about the first families.',
  },
  {
    slug: 'which-subjects-to-offer',
    title: 'Teaching two or three subjects: how to decide what to offer',
    notes: 'Depth versus breadth, matching subjects to levels, why listing everything hurts, and how the subject list drives which tuitions a tutor is shown.',
  },
  {
    slug: 'timetable-alongside-studies',
    title: 'Managing a tutoring timetable alongside university or a job',
    notes: 'Blocking evenings, travel time between homes, saying no to a clash, keeping a weekly plan, and telling parents your availability honestly.',
  },
  {
    slug: 'tutor-to-school-teacher',
    title: 'From private tutor to school teacher, and back: moving between the two',
    notes: 'How private tutoring and a school post differ in hours, pay structure and progression; school jobs posted on TutorMint; what transfers between the two.',
  },
  {
    slug: 'keeping-parents-informed',
    title: 'How tutors keep parents informed without over-promising results',
    notes: 'A short weekly note, what to report, how to talk about a slow month, and why promising a grade is a mistake. No outcome promises.',
  },
  {
    slug: 'late-payments-and-fee-disputes',
    title: 'Dealing with late payments and fee disputes as a tutor',
    notes: 'Agreeing terms up front, a polite reminder, when to pause lessons, and that TutorMint takes no commission and never handles the money between tutor and parent.',
  },
  {
    slug: 'safety-for-tutors',
    title: 'Safety for tutors: visiting homes, boundaries and what to check first',
    notes: 'Meeting in a shared room, telling someone where you are, keeping communication on the platform until trust is built, and reporting a problem.',
  },
  {
    slug: 'what-verification-means-for-tutors',
    title: 'Verification on TutorMint: what the identity check means for a tutor',
    notes: 'What is checked (identity document, photo, selfie), what the badge tells a parent, what it does not promise, and why a verified tutor is shown to parents first.',
  },
  {
    slug: 'degree-certificate-on-profile',
    title: 'Why a degree certificate strengthens a tutor profile',
    notes: 'How a reviewed degree is shown to parents as a watermarked preview, why it matters for higher levels, and that the original is never exposed.',
  },
  {
    slug: 'switching-between-boards',
    title: 'Teaching O Level and Matric students in the same week: switching between boards',
    notes: 'Different syllabi, exam styles and marking, keeping two sets of past papers, and planning lessons so the boards do not blur together.',
  },
  {
    slug: 'introduction-video',
    title: 'Recording an introduction video for your profile: what to say in a minute',
    notes: 'Who you are, what you teach, how you teach, one line about why; good light, a plain background, and why the video is reviewed before it shows.',
  },
  {
    slug: 'group-vs-one-to-one',
    title: 'Group tuition versus one-to-one: which suits a new tutor',
    notes: 'Energy, preparation, fairness to each student, how parents see each, and how a tutor decides. Describe trade-offs in words, no figures.',
  },
  {
    slug: 'growing-a-tutoring-income',
    title: 'Growing a tutoring practice: referrals, repeat families and the long term',
    notes: 'Why a family recommends a tutor, staying in touch between sessions, raising a fee with notice, and keeping a profile current. No income figures.',
  },
  {
    slug: 'quran-and-islamiat-tutoring',
    title: 'Quran and Islamiat tutoring: what families expect and how to prepare',
    notes: 'Tajweed versus memorisation versus Islamiat as a school subject, how families describe what they need, timings around prayer, and respectful online delivery.',
  },
  {
    slug: 'students-with-exam-anxiety',
    title: 'Tutoring a student with exam anxiety: a practical approach for tutors',
    notes: 'Spotting it, structuring sessions, timed practice in small steps, working with the parent, and when to suggest the family seek other help.',
  },
]

/** The career list as queue candidates — a fixed base demand, no seasonality;
 *  the mix balancer, not the priority, is what guarantees their share. */
export function careerCandidates(): Candidate[] {
  return CAREER_TOPICS.map((t) => ({
    fingerprint: `career:${t.slug}`,
    card: 'content',
    source: 'career',
    title: t.title,
    cluster: 'tutor-career',
    audience: 'tutors',
    language: 'en',
    components: { demand: 15, rankProximity: 1, seasonality: 1, gapAge: 1 },
    evidence: ['Evergreen tutor-career topic — the queue keeps about four in ten topics for tutors.'],
    evidenceKey: { topic: t.slug },
    notes: t.notes,
  }))
}
