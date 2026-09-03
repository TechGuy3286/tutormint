// lib/faqContent.ts
//
// The questions people actually ask, and honest answers to them.
//
// Kept out of the page component for one reason: the FAQPage JSON-LD and the
// visible page must be the same text. Structured data that says something the
// page does not say is a manual-action risk, and more practically it is how a
// promise ends up in a search result that nobody on the site ever made.
//
// THE WORDING RULE, which governs every answer here and the packages copy:
//
//   We put tutors in front of parents searching for their subject in their
//   area. We never say "we will get you tuitions".
//
// With no refunds, "we will get you tuitions" is a promise we cannot keep for
// every tutor who pays — and the ones it fails are the ones who will ask for
// their money back and be told no. Visibility is what is actually sold, so
// visibility is what is described.
//
// The comparisons are the argument. An academy taking half of a first month is
// the real alternative a Pakistani parent is weighing, and Meta ad spend is
// the real alternative a tutor is weighing. Both are stated in rupees, because
// "great value" persuades nobody who is doing the arithmetic.

export type FaqItem = { q: string; a: string }
export type FaqGroup = { id: string; heading: string; blurb: string; items: FaqItem[] }

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'parents',
    heading: 'For parents, schools and academies',
    blurb: 'Finding and hiring a tutor.',
    items: [
      {
        q: 'What does "no fee, no commission, no middleman" mean?',
        a: 'It means the fee you agree with a tutor is the fee. TutorMint takes nothing from it — not a placement fee, not a percentage of the first month, not a cut of anything afterwards. We never handle the money between you and the tutor, and we do not need to know what you pay. Our only income is a monthly membership, and only from people who choose to buy one.',
      },
      {
        q: 'An academy takes half the first month’s fee. What do you take?',
        a: 'Nothing from the fee. A home-tuition academy in Lahore or Karachi typically keeps 50% of the first month, so on a Rs 20,000 tuition that is Rs 10,000 gone before the first class, and many keep a share every month after that. On TutorMint the Featured membership is Rs 999 a month and you keep every rupee of what you pay the tutor. If you never buy a membership you can still browse, message tutors and post jobs once you are verified.',
      },
      {
        q: 'Why must I verify my CNIC before I can post a job?',
        a: 'Because a tutor is being asked to travel to a stranger’s house, often a woman travelling alone, and often to an address they have only seen in a message. A CNIC and an address mean the person who posted the job is a real, identifiable household. It is the single thing that most reduces the risk a tutor is taking, and it is why tutors are willing to reply at all. Browsing needs no verification — only posting does.',
      },
      {
        q: 'What does the Verified badge on a tutor mean?',
        a: 'It means an administrator has reviewed that tutor’s introduction video and the degree certificates they uploaded, their profile is 100% complete, and they hold an active membership. It does not mean we have watched them teach or that we guarantee results. It means the person in the profile is the person in the documents.',
      },
      {
        q: 'How are degrees and videos actually checked?',
        a: 'Every tutor uploads an introduction video, which goes to our own YouTube channel as a private video and is reviewed by an administrator before anything is shown to you. Degree certificates are uploaded as images and reviewed the same way. You see watermarked, downscaled previews of certificates — never the original file, which stays in private storage. A tutor gets three attempts at the video; after a third rejection the upload closes and they have to contact support.',
      },
      {
        q: 'Why can I message tutors but not hire until I am Featured?',
        a: 'Messaging, browsing, viewing full profiles, requesting a demo and posting up to five jobs a month are all free once your CNIC and address are approved. Featured (Rs 999 a month) adds three things: the tutor’s phone and WhatsApp, marking an applicant as hired, and priority placement for your jobs. Hiring is the paid step because it is the point at which the platform has actually done its job.',
      },
      {
        q: 'Do you give refunds?',
        a: 'No. Memberships are not refundable, in whole or in part, and that is stated in the Terms before you pay. A membership buys a month of access, and access is delivered the moment it activates. If a payment was taken in error or activated the wrong plan, contact support and we will correct it — that is a mistake, not a refund.',
      },
      {
        q: 'Is my CNIC safe?',
        a: 'Your CNIC image goes into private storage that only you and an administrator reviewing your verification can read; it is never public, never shown to tutors, and never included in a link. The number itself is stored on your profile and is not shown to any other member. It is protected against casual copying, not against a determined attacker — no website can promise that, and we will not.',
      },
      {
        q: 'Can a school or academy use TutorMint?',
        a: 'Yes. Schools and academies register exactly as a parent does and get an ordinary parent account with the same rights, the same plans and the same prices. There is no separate institution tier and nothing is priced differently — you post the tuitions you need filled and hire the same way a family does.',
      },
    ],
  },
  {
    id: 'tutors',
    heading: 'For tutors',
    blurb: 'Getting seen, and what a membership buys.',
    items: [
      {
        q: 'What do I actually get for Rs 199 a month?',
        a: 'You get listed in search with a Verified badge, and you can apply to ten tuitions a month. That puts your profile in front of parents who are already searching for your subject in your area — that is what is being sold. It is not a guarantee of work: whether a parent chooses you depends on your profile, your reply and your experience, and no honest platform can promise otherwise.',
      },
      {
        q: 'How is this different from running my own Meta ads?',
        a: 'An ad has to find someone who might want a tutor. A parent on TutorMint is already looking for one, has already chosen the subject and the area, and in many cases has already posted the job. You also need no website, no landing page, no ad account and no daily budget — a boosted post in one Pakistani city costs more in a week than Rs 199 does in a month, and it stops the moment you stop paying. Your profile keeps working while your membership runs.',
      },
      {
        q: 'What does an academy charge that you do not?',
        a: 'A home-tuition academy typically keeps 50% of your first month and often a share of every month after. On a Rs 20,000 tuition that is Rs 10,000 out of your first month, every time. TutorMint takes 0% of what you earn, forever. The membership is the whole price.',
      },
      {
        q: 'How do I get Verified?',
        a: 'Complete your profile to 100%, upload your introduction video and your degree certificates, and hold an active membership. An administrator reviews the video and the documents. The badge appears once all three are true — and you can pay before your profile is finished: the money is not wasted, the badge simply waits until you get there.',
      },
      {
        q: 'Why is my profile not appearing in search?',
        a: 'Almost always one of three things: your profile is not yet at 100%, your video has not been approved, or your membership has expired. Your dashboard names which one at the top of the page. Tutors below 100% are not listed at all — not ranked lower, not listed — because a half-finished profile is not something a parent can choose from.',
      },
      {
        q: 'What happens when my plan expires?',
        a: 'Your badge, your search ranking and your application quota stop that day. Nothing is deleted: your profile, your conversations, your applications and your reviews all stay exactly where they are, and renewing brings the badge and the ranking straight back. There is no grace period and no automatic renewal — we do not keep your card and we cannot charge you again without you choosing to.',
      },
      {
        q: 'Can I change my city later?',
        a: 'Yes, from your profile settings, as often as you need. Your city and area decide which searches you appear in, so keep them accurate — a tutor listed in a city they cannot travel to gets messages they have to turn down, which helps nobody.',
      },
    ],
  },
]

/** The flat list, for the FAQPage JSON-LD. */
export const FAQ_ITEMS: FaqItem[] = FAQ_GROUPS.flatMap((g) => g.items)
