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
        q: 'What does "no fee, no commission, no middleman" mean?',
        a: 'It means the fee you agree with a tutor is the fee. TutorMint takes nothing from it — not a placement fee, not a percentage of the first month, not a cut of anything afterwards. We never handle the money between you and the tutor, and we do not need to know what you pay. Our only income is a monthly membership, and only from people who choose to buy one.',
        links: [
          { label: 'Browse tutors', href: '/browse/tutors' },
          { label: 'The Terms', href: '/terms' },
        ],
      },
      {
        q: 'An academy takes half the first month’s fee. What do you take?',
        a: 'Nothing from the fee. A home-tuition academy in Lahore or Karachi typically keeps 50% of the first month, so on a Rs 20,000 tuition that is Rs 10,000 gone before the first class, and many keep a share every month after that. On TutorMint the Featured membership is Rs 999 a month and you keep every rupee of what you pay the tutor. If you never buy a membership you can still browse, message tutors and post jobs once you are verified.',
        links: [
          { label: 'Parent memberships', href: '/parent/packages' },
          { label: 'Browse tutors', href: '/browse/tutors' },
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
        a: 'It means an administrator has reviewed that tutor’s introduction video and the degree certificates they uploaded, their profile is 100% complete, and they hold an active membership. It does not mean we have watched them teach or that we guarantee results. It means the person in the profile is the person in the documents.',
        links: [
          { label: 'Verified tutors', href: '/browse/tutors' },
          { label: 'How verification works', href: '/faq#choosing' },
        ],
      },
      {
        q: 'How are degrees and videos actually checked?',
        a: 'Every tutor uploads an introduction video, which goes to our own YouTube channel as a private video and is reviewed by an administrator before anything is shown to you. Degree certificates are uploaded as images and reviewed the same way. You see watermarked, downscaled previews of certificates — never the original file, which stays in private storage. A tutor gets three attempts at the video; after a third rejection the upload closes and they have to contact support.',
        links: [
          { label: 'Browse verified tutors', href: '/browse/tutors' },
          { label: 'Privacy Policy', href: '/privacy' },
        ],
      },
      {
        q: 'Why can I message tutors but not hire until I am Featured?',
        a: 'Messaging, browsing, viewing full profiles, requesting a demo and posting up to five jobs a month are all free once your CNIC and address are approved. Featured (Rs 999 a month) adds three things: the tutor’s phone and WhatsApp, marking an applicant as hired, and priority placement for your jobs. Hiring is the paid step because it is the point at which the platform has actually done its job.',
        links: [
          { label: 'Parent memberships', href: '/parent/packages' },
          { label: 'Verify your account', href: '/parent/verify' },
        ],
      },
      {
        q: 'Do you give refunds?',
        a: 'No. Memberships are not refundable, in whole or in part, and that is stated in the Terms before you pay. A membership buys a month of access, and access is delivered the moment it activates. If a payment was taken in error or activated the wrong plan, contact support and we will correct it — that is a mistake, not a refund.',
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
        q: 'What do I actually get for Rs 199 a month?',
        a: 'You get listed in search with a Verified badge, and you can apply to ten tuitions a month. That puts your profile in front of parents who are already searching for your subject in your area — that is what is being sold. It is not a guarantee of work: whether a parent chooses you depends on your profile, your reply and your experience, and no honest platform can promise otherwise.',
        links: [
          { label: 'Tutor memberships', href: '/tutor/packages' },
          { label: 'Open tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'How is this different from running my own Meta ads?',
        a: 'An ad has to find someone who might want a tutor. A parent on TutorMint is already looking for one, has already chosen the subject and the area, and in many cases has already posted the job. You also need no website, no landing page, no ad account and no daily budget — a boosted post in one Pakistani city costs more in a week than Rs 199 does in a month, and it stops the moment you stop paying. Your profile keeps working while your membership runs.',
        links: [
          { label: 'Tutor memberships', href: '/tutor/packages' },
          { label: 'Open tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'What does an academy charge that you do not?',
        a: 'A home-tuition academy typically keeps 50% of your first month and often a share of every month after. On a Rs 20,000 tuition that is Rs 10,000 out of your first month, every time. TutorMint takes 0% of what you earn, forever. The membership is the whole price.',
        links: [
          { label: 'Tutor memberships', href: '/tutor/packages' },
        ],
      },
      {
        q: 'How do I get Verified?',
        a: 'Complete your profile to 100%, upload your introduction video and your degree certificates, and hold an active membership. An administrator reviews the video and the documents. The badge appears once all three are true — and you can pay before your profile is finished: the money is not wasted, the badge simply waits until you get there.',
        links: [
          { label: 'Complete your profile', href: '/tutor/complete-profile' },
          { label: 'Tutor memberships', href: '/tutor/packages' },
        ],
      },
      {
        q: 'Why is my profile not appearing in search?',
        a: 'Almost always one of three things: your profile is not yet at 100%, your video has not been approved, or your membership has expired. Your dashboard names which one at the top of the page. Tutors below 100% are not listed at all — not ranked lower, not listed — because a half-finished profile is not something a parent can choose from.',
        links: [
          { label: 'Your dashboard', href: '/tutor/dashboard' },
          { label: 'Complete your profile', href: '/tutor/complete-profile' },
        ],
      },
      {
        q: 'What happens when my plan expires?',
        a: 'Your badge, your search ranking and your application quota stop that day. Nothing is deleted: your profile, your conversations, your applications and your reviews all stay exactly where they are, and renewing brings the badge and the ranking straight back. There is no grace period and no automatic renewal — we do not keep your card and we cannot charge you again without you choosing to.',
        links: [
          { label: 'Tutor memberships', href: '/tutor/packages' },
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
        a: 'Every tutor with a Verified badge has had their degree certificates looked at by an administrator, alongside an introduction video where they say who they are. On the profile you can see watermarked previews of those certificates yourself — the originals stay in private storage and are never handed out. If something looks wrong to you, report the profile and it goes to a person, not a queue that nobody reads. What we do not do is contact universities to confirm a degree, and we will not claim otherwise: the check is that the documents were seen and matched the person in the video.',
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
          { label: 'Request a free demo', href: '/browse/tutors' },
          { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
        ],
      },
      {
        q: 'What should I ask a tutor before hiring?',
        a: 'Five things, and they take one conversation. Which exact syllabus and board have you taught — not "science", but "Grade 9 Punjab Board Physics" or "Cambridge O Level Physics". How many students at this level have you taught, and how did they do. What will the first month look like, week by week. What happens when my child misses a class. And what is your fee, monthly, including everything. Then ask for a free demo before you commit to anything: a demo tells you in forty minutes what a profile cannot tell you at all.',
        links: [
          { label: 'Browse tutors', href: '/browse/tutors' },
          { label: 'Parent memberships', href: '/parent/packages' },
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
          { label: 'Parent membership', href: '/parent/packages' },
          { label: 'Sharait (Terms)', href: '/terms' },
        ],
      },
      {
        q: 'Academy pehle mahine ki aadhi fee le leti hai. Aap kitna lete hain?',
        lang: 'ur',
        a: 'Fee mein se kuch nahi. Lahore ya Karachi ki home-tuition academy aam taur par pehle mahine ka 50% rakhti hai — Rs 20,000 ki tuition par Rs 10,000 pehli class se pehle hi chala jata hai, aur kai baar har mahine bhi hissa jata hai. TutorMint par Featured membership Rs 999 mahana hai aur tutor ko di gayi har rupee aap ki apni hai. Membership na bhi lein, tab bhi verification ke baad browse kar sakte hain, tutors ko message bhej sakte hain aur tuition post kar sakte hain.',
        links: [
          { label: 'Parent membership', href: '/parent/packages' },
          { label: 'Tutors dekhein', href: '/browse/tutors' },
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
        a: 'Iska matlab hai ke ek administrator ne us tutor ki taaruf wali video aur uploaded degree certificates dekhe hain, unka profile 100% mukammal hai, aur unki membership chal rahi hai. Iska matlab yeh nahi ke humne unhein parhate hue dekha hai ya nateeje ki zamanat dete hain. Matlab sirf itna hai: profile wala shakhs wohi hai jo dastavezaat mein hai.',
        links: [
          { label: 'Verified tutors', href: '/browse/tutors' },
          { label: 'Madad chahiye', href: '/support' },
        ],
      },
      {
        q: 'Message to kar sakta hoon, hire kyun nahi?',
        lang: 'ur',
        a: 'Browse karna, poora profile dekhna, message bhejna, demo maangna aur mahine mein paanch tuitions post karna — CNIC aur address approve hone ke baad yeh sab muft hai. Featured (Rs 999 mahana) teen cheezein deta hai: tutor ka number aur WhatsApp, kisi applicant ko hired mark karna, aur aap ki tuitions ko ooper dikhana. Hire karna paid qadam is liye hai ke wahi wo lamha hai jab platform ne apna kaam kar diya hota hai.',
        links: [
          { label: 'Parent membership', href: '/parent/packages' },
          { label: 'Account verify karein', href: '/parent/verify' },
        ],
      },
      {
        q: 'Kya paise wapas milte hain?',
        lang: 'ur',
        a: 'Nahi. Membership ki raqam wapas nahi hoti, na poori na thori, aur yeh baat paise dene se pehle Sharait mein likhi hai. Membership ek mahine ki rasai khareedti hai, aur rasai activate hote hi mil jati hai. Agar ghalti se payment li gayi ya ghalat plan chala, to support se rabta karein — hum theek kar denge. Woh ghalti ki durusti hai, refund nahi.',
        links: [
          { label: 'Sharait (Terms)', href: '/terms' },
          { label: 'Support se rabta', href: '/support' },
        ],
      },
      {
        q: 'Rs 199 mein tutor ko kya milta hai?',
        lang: 'ur',
        a: 'Aap search mein Verified badge ke sath list hote hain, aur mahine mein das tuitions par apply kar sakte hain. Isse aap ka profile un walidain ke saamne aata hai jo pehle se aap ke subject aur ilaqay mein tutor dhoond rahe hain — yehi cheez bechi ja rahi hai. Yeh kaam milne ki zamanat nahi hai: kaun chuna jayega yeh aap ke profile, aap ke jawab aur tajurbe par hai, aur koi bhi imaandar platform is se ziyada wada nahi kar sakta.',
        links: [
          { label: 'Tutor membership', href: '/tutor/packages' },
          { label: 'Khuli tuitions', href: '/browse/tuitions' },
        ],
      },
      {
        q: 'Mera profile search mein kyun nahi aa raha?',
        lang: 'ur',
        a: 'Tqreeban hamesha teen mein se ek wajah: profile abhi 100% nahi hua, video approve nahi hui, ya membership khatam ho gayi. Aap ka dashboard sab se ooper bata deta hai ke kaun si wajah hai. 100% se kam wale tutors bilkul list nahi hote — neeche rank nahi hote, list hi nahi hote — kyunke adhoora profile aisi cheez nahi jis mein se koi walid intikhab kar sake.',
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
