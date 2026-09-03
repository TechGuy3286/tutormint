import Breadcrumbs from '@/components/Breadcrumbs'
import { notFound } from 'next/navigation'
import TutorCard, { type TutorCardData } from '@/components/TutorCard'
import JobCard, { type JobCardData } from '@/components/JobCard'
import AdSlot from '@/components/ads/AdSlot'
import ApplyDemo from './ApplyDemo'
import BadgeRow from '@/components/badges/BadgeRow'
import VerifiedBadge from '@/components/badges/VerifiedBadge'
import PremiumBadge from '@/components/badges/PremiumBadge'
import FeaturedBadge from '@/components/badges/FeaturedBadge'
import FeaturedTag from '@/components/badges/FeaturedTag'
import { isProduction } from '@/lib/env'

// A gallery of every card and badge in every plan state.
//
// It exists so a layout regression is visible in one place, at every width,
// without needing a tutor on each plan in the database. Fixture data only --
// nothing here reads from Supabase, and nothing here can be mistaken for a
// real person: the names are labels for the state they demonstrate.
//
// 404 on the live site. The check is on the ENVIRONMENT rather than on a flag,
// so it cannot be switched on in production by a configuration mistake -- there
// is no variable to set. A Vercel preview is not the live site, and a gallery
// of every card in every plan state is exactly what a preview is for.

export const dynamic = 'force-dynamic'

const base: Omit<TutorCardData, 'id' | 'full_name' | 'plan_code' | 'slug'> = {
  headline: 'O/A Level Physics & Mathematics specialist',
  avatar_url: null,
  city: 'Lahore',
  area: 'DHA Phase 5',
  teaching_mode: 'both',
  hourly_rate_pkr: 25000,
  experience_years: 8,
  rating_avg: 4.8,
  rating_count: 31,
  subject_labels: ['Mathematics', 'Physics', 'Further Mathematics'],
}

const TUTORS: TutorCardData[] = [
  { ...base, id: '00000000-0000-0000-0000-000000000001', slug: null, full_name: 'Free Complete', plan_code: null },
  { ...base, id: '00000000-0000-0000-0000-000000000002', slug: null, full_name: 'Verified Plan', plan_code: 'verified' },
  { ...base, id: '00000000-0000-0000-0000-000000000003', slug: null, full_name: 'Premium Plan', plan_code: 'premium' },
  { ...base, id: '00000000-0000-0000-0000-000000000004', slug: null, full_name: 'Featured Plan', plan_code: 'featured' },
  {
    ...base,
    id: '00000000-0000-0000-0000-000000000005',
    slug: null,
    full_name: 'No Reviews Yet',
    plan_code: 'verified',
    rating_avg: 0,
    rating_count: 0,
    avatar_url: null,
    subject_labels: [],
    experience_years: null,
    hourly_rate_pkr: null,
    area: null,
  },
]

const JOBS: JobCardData[] = [
  {
    id: 'job-1',
    job_tx_id: 'JOB-TX-DEMO1',
    public_slug: 'o-level-physics-tutor-needed-dha-phase-5-lahore-demo01',
    status: 'open',
    title: 'O Level Physics tutor needed, DHA Phase 5',
    subjects: ['Physics', 'Mathematics'],
    class_level: 'O Levels',
    city: 'Lahore',
    area: 'DHA Phase 5',
    teaching_mode: 'in_person',
    budget_pkr: 30000,
    description:
      'Two sessions a week for my son, who is preparing for his May series. Evenings preferred.',
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    is_featured: true,
    parent_id: null,
    parent_name: 'Ayesha',
    parent_avatar_url: null,
    parent_badges: ['Verified', 'Featured'],
    parent_can_hire: true,
  },
  {
    id: 'job-2',
    job_tx_id: 'JOB-TX-DEMO2',
    public_slug: 'primary-maths-and-english-twice-weekly-islamabad-demo02',
    status: 'open',
    title: 'Primary Maths and English, twice weekly',
    subjects: ['Mathematics', 'English'],
    class_level: 'Grade 1 to 5',
    city: 'Islamabad',
    area: 'F-8',
    teaching_mode: 'both',
    budget_pkr: 15000,
    description: null,
    created_at: new Date(Date.now() - 4 * 86400_000).toISOString(),
    is_featured: false,
    parent_id: null,
    parent_name: 'Zain',
    parent_avatar_url: null,
    parent_badges: ['Verified'],
    parent_can_hire: false,
  },
]

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-black text-tm-navy">{title}</h2>
        {note && <p className="text-[11px] text-gray-500">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export default function DevComponentsPage() {
  if (isProduction()) notFound()

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <Breadcrumbs items={[{ label: 'Component gallery' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Component gallery</h1>
          <p className="text-xs text-gray-500">
            Development only. Fixture data — none of these are real people. Check every card at 360,
            390, 768, 1024 and 1280.
          </p>
        </header>

        <Section title="Badges" note="sm (icon only) and md (icon + label), in render order.">
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-4">
              <VerifiedBadge size="sm" />
              <PremiumBadge size="sm" />
              <FeaturedBadge size="sm" />
              <FeaturedTag />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <VerifiedBadge size="md" showLabel />
              <PremiumBadge size="md" showLabel />
              <FeaturedBadge size="md" showLabel />
            </div>
            <div className="space-y-2 pt-1">
              {(['verified', 'premium', 'featured'] as const).map((plan) => (
                <p key={plan} className="flex items-center gap-3 text-[11px] font-bold text-gray-500">
                  <span className="w-16">{plan}</span>
                  <BadgeRow
                    badges={
                      plan === 'featured'
                        ? ['Verified', 'Premium', 'Featured']
                        : plan === 'premium'
                          ? ['Verified', 'Premium']
                          : ['Verified']
                    }
                    size="md"
                    showLabel
                  />
                </p>
              ))}
            </div>
          </div>
        </Section>

        <Section
          title="TutorCard — every plan state"
          note="Guest viewer: Shortlist and Demo open the sign-in modal."
        >
          <div className="space-y-4">
            {TUTORS.map((t) => (
              <TutorCard key={t.id} tutor={t} />
            ))}
          </div>
        </Section>

        <Section
          title="TutorCard — four-button layout"
          note="Send Message is hidden on browse until threads land in T5; this is the full design."
        >
          <TutorCard
            tutor={TUTORS[3]}
            showMessage
            viewer={{ signedIn: true, role: 'parent', verifiedParent: true, canInitiateMessage: true }}
          />
        </Section>

        <Section title="JobCard" note="Featured job with a Featured parent, and a standard one.">
          <div className="space-y-4">
            {JOBS.map((j) => (
              <JobCard key={j.id} job={j} href="#" />
            ))}
            <ApplyDemo job={JOBS[0]} />
          </div>
        </Section>

        <Section
          title="Breadcrumbs"
          note="Four levels, which is the deepest trail on the site (/parent/dashboard/job/[id]/edit). Below 640px the middle collapses to an ellipsis so the trail never wraps; the full trail returns at sm. Narrow the window to see it."
        >
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <Breadcrumbs
              items={[
                { label: 'Parent dashboard', href: '/parent/dashboard' },
                { label: 'O Level Physics tutor needed, DHA Phase 5', href: '/parent/dashboard' },
                { label: 'Edit' },
              ]}
            />
          </div>
        </Section>

        <Section title="Ad slot" note="Weighted rotation; falls back to a house creative.">
          <div className="space-y-4">
            <AdSlot slot="browse-inline" audience="parents" />
            <AdSlot slot="tutor-dashboard" audience="tutors" />
          </div>
        </Section>
      </div>
    </main>
  )
}
