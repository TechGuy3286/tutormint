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
// The parents' academy fee comparison example (the Rs 20,000 first-month
// figure, English and Roman Urdu) was removed by the owner on 8 Oct 2026. The
// fee filter bands stay, as does the tutor-side Meta ad-spend comparison.

export type FaqLink = { label: string; href: string }

export type FaqItem = {
  q: string
  a: string
  /**
   * Where to go next.
   *
   * A SEPARATE FIELD, not markup inside `a`, and that is the whole reason it
   * exists: the answer string on the page and the answer string in the
   * FAQPage JSON-LD have to be identical, and an anchor tag in one of them
   * would make them differ. Links are navigation; the answer is the content.
   */
  links?: FaqLink[]
  /** 'ur' marks the Roman-Urdu block, which renders with lang="ur-Latn". */
  lang?: 'en' | 'ur'
}

export type FaqGroup = { id: string; heading: string; blurb: string; items: FaqItem[] }

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'parents',
    heading: 'For parents, schools and academies',
    blurb: 'Finding and hiring a tutor.',
    items: [
      {
        q: 'What does "free to join, no commission, no middleman" mean?',
        a: 'It means the fee you agree with a tutor is the fee. TutorMint takes nothing from it — not a placement fee, not a percentage of the first month, not a cut of anything afterwards. We never handle the money between you and the tutor, and we do not need to know what you pay. Our only income is a monthly membership, and only from people who choose to buy one.',
        links: [
          { label: 'Browse tutors', href: '/browse/tutors' },
          { label: 'The Terms', href: '/terms' },
        ],
      },
      {
        q: 'Why must I verify my CNIC before I can post a job?',
        a: 'Because a tutor is being asked to travel to a stranger’s house, often a woman travelling alone, and often to an address they have only seen in a message. A CNIC and an address mean the person who posted the job is a real, identifiable household. It is the single thing that most reduces the risk a tutor is taking, and it is why tutors are willing to reply at all. Browsing needs no verification — only posting does.',
        links: [
          { label: 'Verify your account', href: '/parent/verify' },
          { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'What does the Verified badge on a tutor mean?',
        a: 'It means the tutor paid the one-time Spam Free Platform Fee and sent a CNIC, a profile photo and a selfie that our team checked. A degree, certificates and an introduction video are optional and not needed for the badge. It does not mean we have watched them teach or that we guarantee results. It means the person in the profile is the person in the documents.',
        links: [
          { label: 'Verified tutors', href: '/browse/tutors' },
          { label: 'How verification works', href: '/faq#choosing' },
        ],
      },
      {
        q: 'How are degrees and videos actually checked?',
        a: 'Both are optional. A tutor who adds an introduction video uploads it to our own YouTube channel as a private video, and an administrator reviews it before anything is shown to you; a tutor gets three attempts. A tutor who adds degree certificates uploads them as images, and you see watermarked, downscaled previews — never the original file, which stays in private storage. Neither is needed for the Verified badge, which comes from the Spam Free Platform Fee plus a CNIC, profile photo and selfie.',
        links: [
          { label: 'Browse verified tutors', href: '/browse/tutors' },
          { label: 'Privacy Policy', href: '/privacy' },
        ],
      },
      {
        q: 'Why can I message tutors but not hire until I am Featured?',
        a: 'Messaging, browsing, viewing full profiles, requesting a demo and posting up to five jobs a month are all free once your CNIC and address are approved. Featured adds three things: the tutor’s phone and WhatsApp, marking an applicant as hired, and priority placement for your jobs. Hiring is the paid step because it is the point at which the platform has actually done its job.',
        links: [
          { label: 'Parent memberships', href: '/membership-plans?for=parents' },
          { label: 'Verify your account', href: '/parent/verify' },
        ],
      },
      {
        q: 'Do you give refunds?',
        a: 'No. The Spam Free Platform Fee and memberships are not refundable, in whole or in part, and that is stated in the Terms before you pay. A membership buys a month of access, and access is delivered the moment it activates. If a payment was taken in error or activated the wrong plan, contact support and we will correct it — that is a mistake, not a refund.',
        links: [
          { label: 'The Terms', href: '/terms' },
          { label: 'Contact support', href: '/support' },
        ],
      },
      {
        q: 'Is my CNIC safe?',
        a: 'Your CNIC image goes into private storage that only you and an administrator reviewing your verification can read; it is never public, never shown to tutors, and never included in a link. The number itself is stored on your profile and is not shown to any other member. It is protected against casual copying, not against a determined attacker — no website can promise that, and we will not.',
        links: [
          { label: 'Privacy Policy', href: '/privacy' },
          { label: 'Verify your account', href: '/parent/verify' },
        ],
      },
      {
        q: 'Can a school or academy use TutorMint?',
        a: 'Yes. Schools and academies register exactly as a parent does and get an ordinary parent account with the same rights, the same plans and the same prices. There is no separate institution tier and nothing is priced differently — you post the tuitions you need filled and hire the same way a family does.',
        links: [
          { label: 'Create an account', href: '/register' },
          { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
        ],
      },
    ],
  },
  {
    id: 'tutors',
    heading: 'For tutors',
    blurb: 'Getting seen, and what a membership buys.',
    items: [
      {
        q: 'What do I get for getting verified?',
        a: 'Getting verified is a one-time step — you pay the Spam Free Platform Fee once, with no renewal and no monthly charge for it. It makes you a verified tutor with a Verified badge, on the free Basic plan: you can apply to ten tuitions a month, see ten parents’ phone and email, message parents in the app and download your CV. That puts your profile in front of parents who are already searching for your subject in your area — that is what is being sold. It is not a guarantee of work: whether a parent chooses you depends on your profile, your reply and your experience, and no honest platform can promise otherwise. Premium and Featured are optional monthly plans: Premium adds 100 applications and parent contact views a month, one-tap WhatsApp to parents and who viewed your profile; Featured makes those unlimited and puts you at the top of search.',
        links: [
          { label: 'Tutor memberships', href: '/membership-plans?for=tutors' },
          { label: 'Open tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'How is this different from running my own Meta ads?',
        a: 'An ad has to find someone who might want a tutor. A parent on TutorMint is already looking for one, has already chosen the subject and the area, and in many cases has already posted the job. You also need no website, no landing page, no ad account and no daily budget — a boosted post in one Pakistani city costs more in a week than getting verified once, and it stops the moment you stop paying. Your profile keeps working once you are verified.',
        links: [
          { label: 'Tutor memberships', href: '/membership-plans?for=tutors' },
          { label: 'Open tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'What does an academy charge that you do not?',
        a: 'A home-tuition academy typically keeps half of your first month and often a share of every month after. TutorMint takes no commission on any tuition, ever.',
        links: [
          { label: 'Tutor memberships', href: '/membership-plans?for=tutors' },
        ],
      },
      {
        q: 'How do I get Verified?',
        a: 'Pay the one-time Spam Free Platform Fee and send your CNIC, a profile photo and a selfie. That is all the Verified badge needs. A degree, certificates and an introduction video are optional extras that help parents trust you, but none of them is needed for any badge.',
        links: [
          { label: 'Complete your profile', href: '/tutor/complete-profile' },
          { label: 'Tutor memberships', href: '/membership-plans?for=tutors' },
        ],
      },
      {
        q: 'Why is my profile not appearing in search?',
        a: 'You show in search once your mobile number is verified and your city, area, subjects and gender are set. Paying the Spam Free Platform Fee and sending your CNIC, profile photo and selfie earns the Verified badge, which puts you above tutors who are not verified. Your dashboard names anything still missing at the top of the page. A fuller profile ranks higher.',
        links: [
          { label: 'Your dashboard', href: '/tutor/dashboard' },
          { label: 'Complete your profile', href: '/tutor/complete-profile' },
        ],
      },
      {
        q: 'What happens when my plan expires?',
        a: 'Your badge, your search ranking and your application quota stop that day. Nothing is deleted: your profile, your conversations, your applications and your reviews all stay exactly where they are, and renewing brings the badge and the ranking straight back. There is no grace period and no automatic renewal — we do not keep your card and we cannot charge you again without you choosing to.',
        links: [
          { label: 'Tutor memberships', href: '/membership-plans?for=tutors' },
          { label: 'The Terms', href: '/terms' },
        ],
      },
      {
        q: 'Can I change my city later?',
        a: 'Yes, from your profile settings, as often as you need. Your city and area decide which searches you appear in, so keep them accurate — a tutor listed in a city they cannot travel to gets messages they have to turn down, which helps nobody.',
        links: [
          { label: 'Profile settings', href: '/tutor/dashboard/settings' },
          { label: 'Browse tutors', href: '/browse/tutors' },
        ],
      },
    ],
  },
  {
    id: 'choosing',
    heading: 'Choosing a tutor',
    blurb: 'The questions parents ask before they hire anyone.',
    items: [
      {
        q: 'How much does a home tutor cost in Lahore?',
        a: 'It depends on the level and the area more than on the city. On TutorMint tutors set their own monthly fee and the filters group them into four bands — under Rs 5,000, Rs 5,000 to 10,000, Rs 10,000 to 20,000, and over Rs 20,000 — so the honest answer is the one in the directory rather than an average we made up. Primary and Middle tuition sits at the lower end; O and A Level, Matric science and test preparation sit higher, and a tutor travelling to DHA or Bahria Town usually asks more than one teaching online. Filter by your subject and area and you are looking at real asking fees, not an estimate. Whatever you agree is what you pay: we take no commission from it.',
        links: [
          { label: 'Tutors in Lahore', href: '/browse/tutors?city=Lahore' },
          { label: 'Post a tuition and let tutors apply', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'How much does a home tutor cost in Karachi?',
        a: 'The same four fee bands apply, and the same rule: level and area move the price far more than the city does. A tutor coming to Clifton or Defence generally asks more than one teaching online or in a nearer neighbourhood, and O and A Level science costs more than Primary. Rather than quoting an average that would be out of date by the time you read it, filter the directory by your subject and area and read what tutors are actually asking. Nothing is added to that figure — TutorMint takes no cut of your fee.',
        links: [
          { label: 'Tutors in Karachi', href: '/browse/tutors?city=Karachi' },
          { label: 'Open tuitions in Karachi', href: '/browse/tuitions?city=Karachi' },
        ],
      },
      {
        q: 'How much does a home tutor cost in Islamabad?',
        a: 'Again, the level and the sector matter more than the city. Filter by your subject and area and you will see the real asking fees in the four bands the site uses, from under Rs 5,000 to over Rs 20,000 a month. If you would rather have tutors come to you with their own figure, post the tuition with a budget band and let them apply — that is free once your CNIC and address are verified.',
        links: [
          { label: 'Tutors in Islamabad', href: '/browse/tutors?city=Islamabad' },
          { label: 'Verify your account', href: '/parent/verify' },
        ],
      },
      {
        q: 'How do I check a tutor’s degree is genuine?',
        a: 'The Verified badge means the tutor paid the Spam Free Platform Fee and sent a CNIC, profile photo and selfie that our team checked. A degree is optional: when a tutor adds certificates, you can see watermarked previews on their profile — the originals stay in private storage and are never handed out. We do not contact universities to confirm a degree, and we will not claim otherwise. If something looks wrong, report the profile and a person looks at it.',
        links: [
          { label: 'Verified tutors', href: '/browse/tutors' },
          { label: 'Contact support', href: '/support' },
        ],
      },
      {
        q: 'O Level or Matric — which should I choose for my child?',
        a: 'That is a decision about where your child is heading, not about tutoring, so take it with their school. Broadly: Matric follows a provincial board, is taught in more schools, costs less, and leads naturally into FSc and local university admissions. O Level follows Cambridge, is examined in May and October series, is more expensive, and travels better internationally. Neither is harder in a way tutoring cannot address. What matters for finding help is that they are different syllabuses — so pick the exact level when you search, because an O Level Physics tutor and a Grade 9 Physics tutor are not interchangeable on this site and are not treated as such.',
        links: [
          // Both go to the directory rather than to a level filter: the browse
          // page filters on a taxonomy_master id, which is a specific
          // level-and-subject pair, and there is no "all of O Level" id to
          // link to. The picker on that page is where the level is chosen.
          { label: 'Choose a level and browse', href: '/browse/tutors' },
          { label: 'Post a tuition at your level', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'Is online tuition as good as home tuition?',
        a: 'For most older students, yes, and for younger ones it usually is not. A Grade 9 or A Level student who can sit still with a laptop loses very little online and gains a much larger choice of tutors — including specialists who are not in your city at all. A Primary child generally needs somebody in the room. Online also removes travel, which is often what makes a good tutor unaffordable or unavailable in the evening. Every tutor on TutorMint says which they offer, and you can filter for it.',
        links: [
          { label: 'Online tutors', href: '/browse/tutors?mode=online' },
          { label: 'In-person tutors', href: '/browse/tutors?mode=in_person' },
        ],
      },
      {
        q: 'How many hours a week does a Grade 9 student need?',
        a: 'Most families start with two to four hours a week per subject and adjust after the first month, which is the only figure worth trusting because it comes from the child rather than from a table. Two hours suits a student who is keeping up and wants to stay there; four suits one who is behind or preparing for board exams. More than that is usually a sign the problem is not time — it is the subject basics, or the timing of the session. Agree the hours with the tutor after a demo rather than before it, and change them when the result says to.',
        links: [
          { label: 'Request a demo lesson', href: '/browse/tutors' },
          { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'What should I ask a tutor before hiring?',
        a: 'Five things, and they take one conversation. Which exact syllabus and board have you taught — not "science", but "Grade 9 Punjab Board Physics" or "Cambridge O Level Physics". How many students at this level have you taught, and how did they do. What will the first month look like, week by week. What happens when my child misses a class. And what is your fee, monthly, including everything. Then ask for a demo lesson before you commit to anything: a demo tells you in forty minutes what a profile cannot tell you at all.',
        links: [
          { label: 'Browse tutors', href: '/browse/tutors' },
          { label: 'Parent memberships', href: '/membership-plans?for=parents' },
        ],
      },
    ],
  },
  {
    id: 'urdu',
    heading: 'Aam sawalat (Roman Urdu)',
    blurb: 'Wohi jawab, Roman Urdu mein.',
    items: [
      {
        q: 'Lahore mein home tutor ki fees kitni hai?',
        lang: 'ur',
        a: 'Fees sheher se ziyada level aur ilaqay par depend karti hai. TutorMint par tutor apni monthly fee khud rakhte hain, aur filter unhein chaar bands mein dikhata hai: Rs 5,000 se kam, Rs 5,000 se 10,000, Rs 10,000 se 20,000, aur Rs 20,000 se ooper. Primary aur Middle ki tuition kam band mein hoti hai; O Level, A Level, Matric science aur test preparation ooper. Apna subject aur ilaqa filter karein aur asli maangi gayi fees dekhein — hum koi average nahi banate. Jo fee aap tutor se tay karte hain, poori unhi ki hai: hum us mein se kuch nahi lete.',
        links: [
          { label: 'Lahore ke tutors', href: '/browse/tutors?city=Lahore' },
          { label: 'Tuition post karein', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'Karachi mein home tutor ki fees kitni hai?',
        lang: 'ur',
        a: 'Wohi chaar fee bands, aur wohi usool: level aur ilaqa sheher se ziyada farq daalte hain. Clifton ya Defence aane wala tutor aam taur par online parhane wale se ziyada maangta hai, aur O ya A Level science Primary se mehngi hoti hai. Apna subject aur ilaqa filter karein aur asli fees khud dekh lein. Us fee mein hum kuch add nahi karte — TutorMint commission nahi leta.',
        links: [
          { label: 'Karachi ke tutors', href: '/browse/tutors?city=Karachi' },
          { label: 'Karachi ki tuitions', href: '/browse/tuitions?city=Karachi' },
        ],
      },
      {
        q: 'TutorMint aap se kya paise leta hai?',
        lang: 'ur',
        a: 'Aap ki fee mein se kuch nahi. Na placement fee, na pehle mahine ka hissa, na baad mein koi commission. Paisa hamare beech se guzarta hi nahi, aur humein yeh jaanne ki zaroorat bhi nahi ke aap kitna dete hain. Hamari waahid aamdani mahana membership hai, aur sirf un logon se jo khud lena chahein.',
        links: [
          { label: 'Parent membership', href: '/membership-plans?for=parents' },
          { label: 'Sharait (Terms)', href: '/terms' },
        ],
      },
      {
        q: 'Job post karne se pehle CNIC verify karna kyun zaroori hai?',
        lang: 'ur',
        a: 'Kyunke tutor ko ek ajnabi ke ghar jana hota hai — aksar akeli khatoon, aur aksar aisay pate par jo sirf ek message mein dekha hai. CNIC aur address ka matlab hai ke post karne wala ek asli, pehchane jaane wala ghar hai. Yehi wo cheez hai jo tutor ka khatra sab se ziyada kam karti hai, aur isi liye tutors jawab dete hain. Sirf browse karne ke liye koi verification nahi chahiye — sirf post karne ke liye.',
        links: [
          { label: 'Account verify karein', href: '/parent/verify' },
          { label: 'Tuition post karein', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'Verified badge ka kya matlab hai?',
        lang: 'ur',
        a: 'Iska matlab hai ke tutor ne ek baar ki Spam Free Platform Fee ada ki aur apna CNIC, profile photo aur selfie bheja, jo hamari team ne check kiya. Degree, certificates aur taaruf wali video ikhtiyari hain aur badge ke liye zaroori nahi. Iska matlab yeh nahi ke humne unhein parhate hue dekha hai ya nateeje ki zamanat dete hain. Matlab sirf itna hai: profile wala shakhs wohi hai jo dastavezaat mein hai.',
        links: [
          { label: 'Verified tutors', href: '/browse/tutors' },
          { label: 'Madad chahiye', href: '/support' },
        ],
      },
      {
        q: 'Message to kar sakta hoon, hire kyun nahi?',
        lang: 'ur',
        a: 'Browse karna, poora profile dekhna, message bhejna, demo maangna aur mahine mein paanch tuitions post karna — CNIC aur address approve hone ke baad yeh sab muft hai. Featured teen cheezein deta hai: tutor ka number aur WhatsApp, kisi applicant ko hired mark karna, aur aap ki tuitions ko ooper dikhana. Hire karna paid qadam is liye hai ke wahi wo lamha hai jab platform ne apna kaam kar diya hota hai.',
        links: [
          { label: 'Parent membership', href: '/membership-plans?for=parents' },
          { label: 'Account verify karein', href: '/parent/verify' },
        ],
      },
      {
        q: 'Kya paise wapas milte hain?',
        lang: 'ur',
        a: 'Nahi. Spam Free Platform Fee aur membership ki raqam wapas nahi hoti, na poori na thori, aur yeh baat paise dene se pehle Sharait mein likhi hai. Membership ek mahine ki rasai khareedti hai, aur rasai activate hote hi mil jati hai. Agar ghalti se payment li gayi ya ghalat plan chala, to support se rabta karein — hum theek kar denge. Woh ghalti ki durusti hai, refund nahi.',
        links: [
          { label: 'Sharait (Terms)', href: '/terms' },
          { label: 'Support se rabta', href: '/support' },
        ],
      },
      {
        q: 'Verified hone se tutor ko kya milta hai?',
        lang: 'ur',
        a: 'Verification ek baar ka kaam hai — aap Spam Free Platform Fee sirf ek dafa ada karte hain, na koi renewal, na koi mahana charge. Is se aap Verified badge ke sath verified tutor ban jate hain, muft Basic plan par: mahine mein das tuitions par apply, das walidain ka phone aur email dekhna, app mein walidain ko message aur apni CV download. Isse aap ka profile un walidain ke saamne aata hai jo pehle se aap ke subject aur ilaqay mein tutor dhoond rahe hain — yehi cheez bechi ja rahi hai. Yeh kaam milne ki zamanat nahi hai: kaun chuna jayega yeh aap ke profile, aap ke jawab aur tajurbe par hai. Premium aur Featured ikhtiyari mahana plans hain: Premium mahine mein 100 applications aur 100 contact views, ek tap WhatsApp aur profile dekhne walon ke naam deta hai; Featured yeh sab unlimited karta hai aur search mein sab se ooper rakhta hai.',
        links: [
          { label: 'Tutor membership', href: '/membership-plans?for=tutors' },
          { label: 'Khuli tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'Mera profile search mein kyun nahi aa raha?',
        lang: 'ur',
        a: 'Search mein aane ke liye aap ka mobile number verified ho aur shehar, ilaqa, subjects aur gender set hon. Spam Free Platform Fee ada karna aur CNIC, profile photo aur selfie bhejna Verified badge deta hai, jo aap ko ghair verified tutors se ooper rakhta hai. Jo cheez baqi ho, dashboard sab se ooper bata deta hai. Zyada mukammal profile behtar rank hota hai.',
        links: [
          { label: 'Dashboard', href: '/tutor/dashboard' },
          { label: 'Profile mukammal karein', href: '/tutor/complete-profile' },
        ],
      },
    ],
  },
]

/** The flat list, for the FAQPage JSON-LD. */
export const FAQ_ITEMS: FaqItem[] = FAQ_GROUPS.flatMap((g) => g.items)
