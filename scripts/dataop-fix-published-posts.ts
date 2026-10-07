// scripts/dataop-fix-published-posts.ts
//
// One-time, owner-approved correction of the 5 published blog posts (owner,
// 7 Oct 2026) so they match the Membership Plans page and the verification rule:
// the Verified badge = Spam Free Platform Fee + CNIC, photo and selfie (degree,
// certificates, intro video optional); the fee is always the "Spam Free Platform
// Fee"; no "no fee" claims; every closing call to action linked; descriptive
// link text; no /membership-plans links; dead and noindex links pointed at the
// matching /tuition-jobs/<city> page; a meta description per post without the
// tagline.
//
// KEEPS each post's URL, title, publish date, approval and structure (no heading
// added or removed). Sets updated_at. Writes a post_revisions row (the record an
// editor save writes) and an admin_audit_log 'blog.fix_published' row per post.
//
// Every replacement must match EXACTLY ONCE in the current body or the script
// refuses for that post, so it cannot edit text that has changed since.
//
//   npx tsx --env-file=.env.local scripts/dataop-fix-published-posts.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/dataop-fix-published-posts.ts --apply

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Fix = { slug: string; meta: string; edits: [string, string][] }

const NO_COMMISSION = 'TutorMint takes no commission on any tuition.'

const FIXES: Fix[] = [
  {
    slug: 'grade-9-10-science-english-tutors-in-lahore-fees-and-how-to-choose',
    meta: 'How to find and choose a Grade 9 & 10 Science English tutor in Lahore: what affects fees, what to ask, and in-person or online tuition.',
    edits: [
      [
        "You can browse [O Levels Physics tuitions in Lahore](/tuitions/lahore/o-levels-physics) or [O Levels Mathematics tutors in Lahore](/tutors/lahore/o-levels-mathematics) if that's the track your child is on.",
        "You can browse [tuition jobs in Lahore](/tuition-jobs/lahore), including O Levels Physics and O Levels Mathematics, and read our [O and A Level October–November exam prep guide](/blog/o-and-a-level-october-november-exam-prep-2026) if that's the track your child is on.",
      ],
      [
        'there are listings for [Grade 9 & 10 Arts English](/tuitions/lahore/grade-9-10-arts-english) and [Grade 9 & 10 Arts Urdu](/tuitions/lahore/grade-9-10-arts-urdu) tuitions in Lahore as well.',
        'there are Grade 9 & 10 Arts English and Grade 9 & 10 Arts Urdu tuitions in Lahore as well.',
      ],
      [
        'through a subject tutor like the ones listed for [Grade 9 & 10 Arts English](/tuitions/lahore/grade-9-10-arts-english), so the two issues',
        'through a Grade 9 & 10 Arts English tutor, so the two issues',
      ],
      [
        "TutorMint verifies tutors before they're listed, so parents can check a tutor's profile and background before reaching out. There's no fee or commission involved on either side — you post what you need, and tutors get in touch directly.",
        `Look for the Verified badge on a tutor's profile: it means the tutor paid the Spam Free Platform Fee and sent a CNIC, profile photo and selfie that our team checked. A degree and an introduction video are optional. ${NO_COMMISSION}`,
      ],
      [
        'Post your tuition requirement on TutorMint and let verified tutors come to you — no fee, no commission, no middleman.',
        `Post your tuition requirement on TutorMint and let verified tutors come to you, or [browse tutors near you](/browse/tutors). ${NO_COMMISSION}`,
      ],
    ],
  },
  {
    slug: 'keeping-messages-useful-how-tutormint-handles-spam',
    meta: 'How TutorMint keeps tutor and parent messages useful, what spam looks like, and how to report a message that is not a genuine tuition enquiry.',
    edits: [
      [
        'The platform is built around that single purpose: no fee, no commission, no middleman, and no room for the messaging system to turn into an ad space.',
        `${NO_COMMISSION} The messaging system is for tuition enquiries, with no room for it to turn into an ad space.`,
      ],
      [
        "For example, if you've posted a tuition for /tuitions/lahore/grade-1-to-5-mathematics or /tuitions/lahore/grade-1-to-5-urdu, mention the child's grade and the area of Lahore when you message a tutor. If it's for /tuitions/lahore/o-levels-physics, mention the board and whether it's for exams or regular coursework.",
        "For example, if you've posted a Mathematics or Urdu tuition for a primary grade, mention the child's grade and the area of Lahore when you message a tutor — the [tuition jobs in Lahore](/tuition-jobs/lahore) show how other parents describe theirs. If it's for O Levels Physics, mention the board and whether it's for exams or regular coursework.",
      ],
      [
        "It's worth writing each reply as if the parent is going to read it and judge whether you actually read theirs.",
        "It's worth writing each reply as if the parent is going to read it and judge whether you actually read theirs — our guide on [how to become a home tutor in Pakistan](/blog/how-to-become-a-home-tutor-in-pakistan-a-step-by-step-start) covers presenting yourself well.",
      ],
      [
        "If you're a parent, post your tuition and expect replies that are actually about your child's subject and grade — not ads. If you're a tutor, join TutorMint and reply the way you'd want a reply written to you: specific, honest, and about the actual tuition. No fee, no commission, no middleman.",
        `If you're a parent, post your tuition or [browse tutors](/browse/tutors) and expect replies that are actually about your child's subject and grade — not ads. If you're a tutor, [create your free tutor profile](/apply) and reply the way you'd want a reply written to you: specific, honest, and about the actual tuition. ${NO_COMMISSION}`,
      ],
    ],
  },
  {
    slug: 'grade-9-10-science-physics-tutors-in-islamabad-fees-and-how-to-choose',
    meta: 'How to choose and afford a Grade 9 & 10 Physics tutor in Islamabad: what affects fees, what to ask in a demo lesson, and what the Verified badge means.',
    edits: [
      [
        "On TutorMint, a tutor's Verified badge means the team has checked their CNIC, a degree certificate, and an introduction video. It tells you their identity and paperwork have been reviewed.",
        "On TutorMint, a tutor's Verified badge means the tutor paid the Spam Free Platform Fee and sent a CNIC, profile photo and selfie that our team checked; a degree and an introduction video are optional. It tells you their identity has been reviewed.",
      ],
      [
        'You can compare profiles and read what tutors have written about their own experience by browsing [tutors on TutorMint](/browse/tutors).',
        'You can compare profiles and read what tutors have written about their own experience by browsing tutors on TutorMint.',
      ],
      [
        "Start by looking for the Verified badge. It tells you the tutor's identity, a degree certificate, and an introduction video have been reviewed by the TutorMint team.",
        'Start by looking for the Verified badge. It tells you the tutor paid the Spam Free Platform Fee and that their CNIC, profile photo and selfie were checked by the TutorMint team.',
      ],
      [
        'Parents sometimes also want the flexibility of a Featured account, which is explained on [membership plans](/membership-plans).',
        'Parents sometimes also want a Featured account, which adds tutor phone numbers, one-tap WhatsApp and completing a hire.',
      ],
      [
        "Verified tutors have had their CNIC, a degree certificate and an introduction video reviewed by the team. Experience, subjects and fees are self-declared and aren't checked,",
        "Verified tutors have paid the Spam Free Platform Fee and had their CNIC, profile photo and selfie checked by the team; a degree and an introduction video are optional. Experience, subjects and fees are self-declared and aren't checked,",
      ],
      [
        'You can post a tuition describing the grade, syllabus and area, and Physics tutors in Islamabad who match can apply.',
        'You can post a tuition describing the grade, syllabus and area, and Physics tutors in Islamabad who match can apply — see what is already posted on [tuition jobs in Islamabad](/tuition-jobs/islamabad).',
      ],
      [
        'Ready to start? Post a tuition or browse tutors in Islamabad today.',
        'Ready to start? Post a tuition or [browse tutors in Islamabad](/browse/tutors) today.',
      ],
    ],
  },
  {
    slug: 'o-and-a-level-october-november-exam-prep-2026',
    meta: 'Prepare for the O and A Level October–November 2026 exams with revision steps, past paper practice and short, focused tutor support.',
    edits: [
      [
        'as often comes up in work like [open tuitions for O Levels Chemistry in Lahore](/tuitions/lahore/o-levels-chemistry).',
        'as often comes up in O Levels Chemistry tuitions among the [tuition jobs in Lahore](/tuition-jobs/lahore).',
      ],
      [
        "It means the tutor has paid the one-time verification fee and has a degree certificate on file that TutorMint's team has reviewed.",
        "It means the tutor has paid the one-time Spam Free Platform Fee and sent a CNIC, profile photo and selfie that TutorMint's team checks; a degree and an introduction video are optional.",
      ],
      [
        'Tutors who want to stand out during this exam season can look at [membership plans](/membership-plans) for more visibility.',
        'Tutors who want to stand out during this exam season can look at the Premium and Featured plans for more visibility.',
      ],
      [
        "now's the time to act — browse tutors or post a tuition and take the next step before the exam clock runs out.",
        "now's the time to act — browse tutors, post a tuition or [see open tuitions](/browse/tuitions), and take the next step before the exam clock runs out.",
      ],
    ],
  },
  {
    slug: 'how-to-become-a-home-tutor-in-pakistan-a-step-by-step-start',
    meta: 'How to start as a home tutor in Pakistan: set up your TutorMint profile, choose subjects, set a fair fee, find tuitions and build a reputation.',
    edits: [
      [
        "Completing your one-time verification adds the Verified badge next to your name, which includes your reviewed degree certificate, and it's what lets you reply to parents and apply to tuitions directly,",
        "Paying the one-time Spam Free Platform Fee and sending your CNIC, profile photo and selfie adds the Verified badge next to your name, and it's what lets you reply to parents and apply to tuitions directly,",
      ],
      [
        'You can create a profile without one, but the Verified badge requires a reviewed degree certificate on file, along with your identity document and an introduction video the team looks at.',
        'No. You can register without one, and the Verified badge comes from the Spam Free Platform Fee plus your CNIC, a profile photo and a selfie; a degree, certificates and an introduction video are optional.',
      ],
      [
        'A verified tutor on the Basic plan can reply to any parent who messages first. Only Premium and Featured tutors can start a conversation with a parent.',
        'Every verified tutor can message parents in the app. Premium and Featured add more: parent phone and email views, and one-tap WhatsApp.',
      ],
      [
        'Ready to put your profile in front of parents? Create your listing and start browsing open tuitions today.',
        'Ready to put your profile in front of parents? [Create your free tutor profile](/apply) and start browsing open tuitions today.',
      ],
      [
        'More on TutorMint: see [a related guide](/blog/o-and-a-level-october-november-exam-prep-2026).',
        'More on TutorMint: see [O and A Level October–November exam prep, 2026](/blog/o-and-a-level-october-november-exam-prep-2026).',
      ],
    ],
  },
]

function count(hay: string, needle: string): number {
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const owner = (await c.query("select id, email from profiles where admin_role = 'owner' limit 1")).rows[0]
  if (!owner) throw new Error('no owner account')

  let failed = false
  const planned: { row: Record<string, unknown>; body: string; meta: string }[] = []
  for (const fix of FIXES) {
    const { rows } = await c.query("select * from posts where slug = $1 and status = 'published'", [fix.slug])
    const row = rows[0]
    if (!row) { console.log('REFUSE: not found or not published', fix.slug); failed = true; continue }
    let body = row.body as string
    for (const [from, to] of fix.edits) {
      const n = count(body, from)
      if (n !== 1) { console.log(`REFUSE ${fix.slug}: expected 1 match, found ${n}: "${from.slice(0, 70)}…"`); failed = true; continue }
      body = body.replace(from, to)
    }
    if (fix.meta.length > 155) { console.log(`REFUSE ${fix.slug}: meta ${fix.meta.length} > 155`); failed = true }
    planned.push({ row, body, meta: fix.meta })
    console.log(`${fix.slug}: ${fix.edits.length} edits, meta ${fix.meta.length} chars`)
  }
  if (failed) { console.log('Nothing written.'); await c.end(); process.exit(1) }
  const outAt = process.argv.indexOf('--out')
  if (outAt > 0 && process.argv[outAt + 1]) {
    const fs = await import('fs')
    fs.writeFileSync(
      process.argv[outAt + 1],
      JSON.stringify(planned.map((p) => ({ slug: p.row.slug, title: p.row.title, cluster: p.row.cluster, audience: p.row.audience, seo_title: p.row.seo_title, seo_description: p.meta, body: p.body })), null, 1),
    )
  }
  if (!apply) { console.log('Dry run — nothing written. Re-run with --apply.'); await c.end(); return }

  await c.query('begin')
  try {
    for (const { row, body, meta } of planned) {
      await c.query('update posts set body = $1, seo_description = $2, updated_at = now() where id = $3', [body, meta, row.id])
      await c.query(
        `insert into post_revisions (post_id, title, slug, cluster, audience, language, body, cover_path, cover_alt, seo_title, seo_description, related_landing_pages, source_notes, status, editor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [row.id, row.title, row.slug, row.cluster, row.audience, row.language, body, row.cover_path, row.cover_alt, row.seo_title, meta, row.related_landing_pages, row.source_notes, row.status, owner.id],
      )
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values ($1,$2,'owner','blog.fix_published','post',$3,$4)`,
        [owner.id, owner.email, row.id, JSON.stringify({ slug: row.slug, reason: 'owner-approved correction to the Membership Plans page and verification rule (7 Oct 2026)', script: 'scripts/dataop-fix-published-posts.ts' })],
      )
    }
    await c.query('commit')
    console.log(`Applied to ${planned.length} posts.`)
  } catch (e) {
    await c.query('rollback')
    throw e
  }
  await c.end()
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
