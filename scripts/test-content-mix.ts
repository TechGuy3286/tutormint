/**
 * scripts/test-content-mix.ts — the pure rules behind the blog writer changes of
 * 6 Oct 2026: the content-queue dedupe (no city/grade/subject variants), the
 * ≈40% tutor-career mix, Search Console rows → topics, the career list's shape,
 * the ranked related-landing list, and the new link rules + fixer.
 *
 *   npm run test:contentmix
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { balanceMix, clusterForQuery, collapseByQuery, dedupeTitles, gscCandidate, titleFromQuery } from '../lib/contentQueue/mix'
import { CAREER_TOPICS, careerCandidates } from '../lib/contentQueue/careerTopics'
import { titleSkeleton } from '../lib/blogApproval'
import { rankLandingOptions } from '../lib/blog'
import { linkRuleViolations } from '../lib/ai/platformFacts'
import { collectBlogProblems, landingLinkText, sanitizeDraft } from '../lib/ai/blogChecker'
import { BLOG_MIN_WORDS, BLOG_MAX_WORDS, BLOG_WARN_WORDS } from '../lib/ai/blogBrief'
import { LINK_MAP } from '../lib/ai/blogRoutes'

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi']
const SUBJECTS = ['Mathematics', 'Physics', 'English', 'Computer Science', 'Chemistry']

const cand = (title: string, fingerprint: string, demand = 10, cluster: string | null = 'cost-hiring', card: 'content' | 'recruitment' = 'content') => ({
  title,
  fingerprint,
  card,
  cluster,
  components: { demand, rankProximity: 1, seasonality: 1, gapAge: 1 },
})

test('dedupe: a title that differs only by city/subject/grade from an existing post or suggestion is dropped', () => {
  const existing = [
    { title: 'Grade 9 & 10 - Science English tutors in Lahore: fees and how to choose' }, // a post
    { title: 'O Levels Physics tutors in Lahore: fees and how to choose', fingerprint: 'search:tutors:249:lahore' }, // a dismissed suggestion
  ]
  const out = dedupeTitles(
    [
      cand('Grade 8 Mathematics tutors in Karachi: fees and how to choose', 'search:tutors:100:karachi'),
      cand('How to become a home tutor in Pakistan: a step-by-step start', 'career:become-home-tutor'),
    ],
    existing,
    CITIES,
    SUBJECTS,
  )
  assert.deepEqual(out.map((c) => c.fingerprint), ['career:become-home-tutor'])
})

test('dedupe: a candidate refreshing its OWN existing row is kept; two new variants keep only the first', () => {
  const existing = [{ title: 'O Levels Physics tutors in Lahore: fees and how to choose', fingerprint: 'search:tutors:249:lahore' }]
  const out = dedupeTitles(
    [
      cand('O Levels Physics tutors in Lahore: fees and how to choose', 'search:tutors:249:lahore', 50),
      cand('Grade 6 Mathematics tutors in Karachi: a complete guide', 'coverage:a', 30),
      cand('Grade 7 English tutors in Islamabad: a complete guide', 'coverage:b', 20),
    ],
    existing,
    CITIES,
    SUBJECTS,
  )
  assert.deepEqual(out.map((c) => c.fingerprint), ['search:tutors:249:lahore', 'coverage:a'])
})

test('balance: career topics are kept and others are capped so career is about 40%', () => {
  const career = Array.from({ length: 4 }, (_, i) => cand(`Career ${i}`, `career:${i}`, 15, 'tutor-career'))
  const others = Array.from({ length: 20 }, (_, i) => cand(`Other ${i}`, `gsc:${i}`, 100 - i))
  const recruit = [cand('Karachi: searches', 'recruit:1', 9, null, 'recruitment')]
  const out = balanceMix([...others, ...career, ...recruit])
  const content = out.filter((c) => c.card === 'content')
  const careerOut = content.filter((c) => c.cluster === 'tutor-career')
  assert.equal(careerOut.length, 4)
  assert.equal(content.length - careerOut.length, 6) // floor(4 * 0.6 / 0.4) = 6
  assert.ok(out.some((c) => c.card === 'recruitment'), 'recruitment cards pass through')
  // The strongest others survive.
  assert.ok(content.some((c) => c.fingerprint === 'gsc:0'))
  assert.ok(!content.some((c) => c.fingerprint === 'gsc:19'))
  // No career topics → nothing is cut.
  assert.equal(balanceMix(others).length, 20)
})

test('career list: twenty distinct shapes, all tutor-career for tutors, no numbers in notes', () => {
  assert.ok(CAREER_TOPICS.length >= 15)
  const skeletons = new Set(CAREER_TOPICS.map((t) => titleSkeleton(t.title, CITIES, SUBJECTS)))
  assert.equal(skeletons.size, CAREER_TOPICS.length, 'no two career titles share a skeleton')
  for (const c of careerCandidates()) {
    assert.equal(c.cluster, 'tutor-career')
    assert.equal(c.audience, 'tutors')
    assert.equal(c.source, 'career')
    assert.ok(!/\d/.test(c.notes), `notes carry no figure: ${c.fingerprint}`)
  }
})

test('Search Console: cluster + audience from the words, the query as the title, positions 8–20 only', () => {
  assert.deepEqual(clusterForQuery('home tutor jobs in lahore'), { cluster: 'tutor-career', audience: 'tutors' })
  assert.deepEqual(clusterForQuery('matric exam preparation tips'), { cluster: 'boards-exams', audience: 'both' })
  assert.deepEqual(clusterForQuery('is tutormint safe'), { cluster: 'safety-trust', audience: 'both' })
  assert.deepEqual(clusterForQuery('home tutor fees in karachi'), { cluster: 'cost-hiring', audience: 'parents' })
  assert.deepEqual(clusterForQuery('best areas in lahore', ['Lahore']), { cluster: 'city-guides', audience: 'parents' })
  assert.equal(titleFromQuery('how to find a home tutor in lahore'), 'How to find a home tutor in lahore?')
  assert.equal(titleFromQuery('  physics   tutor  '), 'Physics tutor')
  const row = { query: 'how much does a home tutor cost in karachi', page: 'https://www.tutormint.org/browse/tutors', clicks: 2, impressions: 40, position: 9.4 }
  const c = gscCandidate(row)
  assert.ok(c)
  assert.equal(c!.source, 'gsc')
  assert.equal(c!.cluster, 'cost-hiring')
  assert.equal(c!.notes, '', 'figures never go to the model as facts')
  assert.ok(c!.evidence[0].includes('40 impressions'))
  assert.equal(gscCandidate({ ...row, position: 3 }), null, 'already on page one')
  assert.equal(gscCandidate({ ...row, position: 25 }), null, 'too far down')
  assert.equal(gscCandidate({ ...row, impressions: 1 }), null, 'noise')
  const collapsed = collapseByQuery([row, { ...row, page: 'https://www.tutormint.org/', position: 14, impressions: 10, clicks: 0 }])
  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].impressions, 50)
  assert.equal(collapsed[0].position, 9.4)
})

test('related landing pages rank by match with the post: both, then subject, then city — never alphabetical', () => {
  const opts = [
    { path: 'tutors/karachi/grade-1-mathematics', label: 'A Grade 1 Mathematics · Karachi (tutors)', city: 'Karachi', subject: 'Grade 1 Mathematics', count: 9 },
    { path: 'tutors/lahore/grade-1-mathematics', label: 'Z Grade 1 Mathematics · Lahore (tutors)', city: 'Lahore', subject: 'Grade 1 Mathematics', count: 5 },
    { path: 'tutors/lahore/grade-2-english', label: 'B Grade 2 English · Lahore (tutors)', city: 'Lahore', subject: 'Grade 2 English', count: 7 },
    { path: 'tutors/islamabad/o-levels-physics', label: 'C O Levels Physics · Islamabad (tutors)', city: 'Islamabad', subject: 'O Levels Physics', count: 12 },
  ]
  const ranked = rankLandingOptions(opts, 'Lahore', 'Grade 1 Mathematics')
  assert.deepEqual(
    ranked.map((o) => o.path),
    ['tutors/lahore/grade-1-mathematics', 'tutors/karachi/grade-1-mathematics', 'tutors/lahore/grade-2-english', 'tutors/islamabad/o-levels-physics'],
  )
  // No city/subject on the post: by listings, not by label.
  assert.equal(rankLandingOptions(opts, '', '')[0].path, 'tutors/islamabad/o-levels-physics')
})

test('link rules: landing/tuition + another post or profile required; /membership-plans and /faq not required', () => {
  const good = [
    'Find [Grade 1 Mathematics tutors in Lahore](/tutors/lahore/grade-1-mathematics).',
    'Read [our O Level guide](/blog/o-level-guide) and [browse tutors](/browse/tutors).',
  ].join('\n')
  assert.deepEqual(linkRuleViolations(good, { hasPublishedPosts: true, hasLandingPages: true }), [])
  // A tutor profile satisfies the second rule too.
  const withProfile = '[tutors in Lahore](/tutors/lahore/grade-1-mathematics) [Ali Sabeer](/tutor/ali-sabeer) [the FAQ](/faq)'
  assert.deepEqual(linkRuleViolations(withProfile, { hasPublishedPosts: false, hasTutorProfiles: true, hasLandingPages: true }), [])
  // Missing the landing link.
  const noLanding = '[a guide](/blog/x) [the FAQ](/faq) [browse tutors](/browse/tutors)'
  assert.ok(linkRuleViolations(noLanding, { hasPublishedPosts: true, hasLandingPages: true }).some((v) => /landing page/.test(v)))
  // Missing the post/profile link.
  const noPost = '[tutors in Lahore](/tutors/lahore/x) [the FAQ](/faq) [browse tutors](/browse/tutors)'
  assert.ok(linkRuleViolations(noPost, { hasPublishedPosts: true, hasLandingPages: true }).some((v) => /another blog post or an indexable tutor profile/.test(v)))
  // No /membership-plans or /faq requirement anywhere.
  const all = linkRuleViolations(noLanding, { hasPublishedPosts: true, hasLandingPages: true })
  assert.ok(!all.some((v) => /membership-plans|\/faq/.test(v)))
  // Pricing is not offered to the AI or the Link picker.
  assert.ok(!LINK_MAP.some((l) => l.path === '/membership-plans'))
  assert.ok(LINK_MAP.some((l) => l.path === '/faq'), '/faq stays offered (optional)')
})

test('fixer: adds a landing link and a post/profile link when missing, and the result passes the checker', () => {
  const ctx = { publishedPostSlugs: ['o-level-guide'], landingPaths: ['/tutors/lahore/grade-1-mathematics'], tutorSlugs: ['ali-sabeer'] }
  const fixed = sanitizeDraft('## A guide\n\nSome prose with no links at all.', {
    blogSlugs: ctx.publishedPostSlugs,
    audience: 'parents',
    landingPaths: ctx.landingPaths,
    tutorSlugs: ctx.tutorSlugs,
  })
  assert.ok(fixed.includes('](/tutors/lahore/grade-1-mathematics)'))
  assert.ok(fixed.includes('](/blog/o-level-guide)'))
  assert.ok(!fixed.includes('/membership-plans'))
  assert.deepEqual(collectBlogProblems(fixed, ctx), [])
  // With no published post, an indexable tutor profile is the fallback.
  const fixed2 = sanitizeDraft('## A guide\n\nProse.', { blogSlugs: [], audience: 'tutors', landingPaths: ctx.landingPaths, tutorSlugs: ['ali-sabeer'] })
  assert.ok(fixed2.includes('](/tutor/ali-sabeer)'))
  assert.deepEqual(collectBlogProblems(fixed2, { ...ctx, publishedPostSlugs: [] }), [])
  // A link to a NON-indexable profile is unlinked, the words kept.
  const fixed3 = sanitizeDraft('See [Someone](/tutor/not-indexable) today.', { blogSlugs: ['o-level-guide'], audience: 'both', landingPaths: ctx.landingPaths, tutorSlugs: ['ali-sabeer'] })
  assert.ok(!fixed3.includes('(/tutor/not-indexable)'))
  assert.ok(fixed3.includes('Someone'))
  assert.equal(landingLinkText('/tutors/lahore/grade-1-mathematics'), 'Grade 1 Mathematics tutors in Lahore')
  assert.equal(landingLinkText('/tuitions/karachi/o-levels-physics'), 'O Levels Physics tuitions in Karachi')
})

test('length target: 900–1,500 words, warning line at 800', () => {
  assert.equal(BLOG_MIN_WORDS, 900)
  assert.equal(BLOG_MAX_WORDS, 1500)
  assert.equal(BLOG_WARN_WORDS, 800)
})
