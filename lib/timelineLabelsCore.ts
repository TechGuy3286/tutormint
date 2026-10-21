// lib/timelineLabelsCore.ts
//
// Plain-English names for every admin action that can reach the member
// timeline (owner, 20 Oct 2026). Before this, an action with no name of its
// own fell through to a word-by-word reading of its code — "Staff my signups
// whatsapp", "Location not area", "Job pause". Every action written by the
// code, and every one already stored in admin_audit_log, has its own line
// here; scripts/test-timeline-labels.ts fails when a new one is added without
// a name, or when any name contains an underscore, a dot or a code-style word.
//
// Each name is read beside "by <staff name>" on the timeline, so most are
// written as what the staff member did ("Paused a tuition"). The few in
// ACTOR_FIRST put the staff member's name first instead ("Aqsa sent a WhatsApp
// from My sign-ups") and the timeline then leaves out the "by …" line.
//
// PURE — no I/O.

export const AUDIT_LABELS: Record<string, string> = {
  // Accounts
  'account.delete': 'Deleted an account',
  'account.free_leftover': 'Freed a mobile number left by a deleted account',
  'user.delete': 'Deleted an account',
  'member.delete': 'Deleted an account',
  'orphan.backfill': 'Created a missing profile',
  'member.second_role': 'Created a second account on the same mobile',
  'member.hide_public': 'Hid the account from public pages',
  'member.unhide_public': 'Took off the test-account mark',
  'member.not_interested': 'Marked as not interested on Follow-ups',
  'member.not_interested_undo': 'Put back on Follow-ups (not interested undone)',
  'member.self_pause': 'Paused their own account',
  'member.self_restore': 'Account came back after a pause',
  'member.email_unblock': 'Let them sign in before confirming their email',
  'member.one_off_email': 'Sent a one-time email',
  'member.export': 'Downloaded the member list',
  'member.change_mobile': 'Changed the mobile number',
  'member.verify_mobile': 'Verified the mobile number by hand',
  'mobile.clear_verification': 'Cleared the mobile verification',
  'otp.reset': 'Reset the verification codes',
  'view_as_tutor': 'Viewed the dashboard as this tutor',

  // Moderation
  'member.warn': 'Warned',
  'member.suspend': 'Suspended',
  'member.unsuspend': 'Reinstated',
  'member.ban': 'Banned for fraud',
  'member.unban': 'Ban lifted',
  'member.message': 'Sent a message from the TutorMint team',
  'member.follow_up': 'Followed up',
  'member.whatsapp_open': 'Opened a WhatsApp chat with a pre-filled message',
  'member.follow_up_undo': 'Undid a follow-up',
  'report.action': 'Acted on a report',
  'report.dismiss': 'Dismissed a report',
  'flag.clear': 'Cleared a flagged message',
  'owner.protection_blocked': 'Tried to change the Owner account and was stopped',

  // Documents and verification
  'tutor.approve': 'Approved the tutor',
  'tutor.hold': 'Put the introduction video on hold',
  'tutor.suspend': 'Suspended the tutor',
  'tutor.unsuspend': 'Reinstated the tutor',
  'tutor.edit': 'Edited the tutor record',
  'tutor.slug': 'Changed the profile address',
  'tutor.import': 'Added tutors by bulk import',
  'tutor.onboarding_done': 'Marked onboarding as done',
  'tutor.verification_removed': 'Removed the verification',
  'parent.verify.approve': 'Approved parent verification',
  'parent.verify.reject': 'Rejected parent verification',
  'document.unlock': 'Unlocked a document for re-upload',
  'document.owner_replace': 'Replaced an approved document',
  'document.restore_side': 'Restored a hidden CNIC side',
  'document.rotate': 'Turned a document image',
  'profile_photo.rotate': 'Turned the profile picture',
  'profile_photo.crop': 'Cropped the profile picture',
  'profile_photo.crop_reset': 'Reset the profile picture crop',
  'cnic.reveal': 'Showed the full CNIC number',
  'video.visibility': 'Changed who can see the video',

  // Money
  'plan.grant': 'Plan granted',
  'plan.revoke': 'Plan removed',
  'plan.settings': 'Changed a plan setting',
  'payment.approve': 'Payment approved',
  'payment.bank_link': 'Recorded a bank payment from a bank credit',
  'payment.reject': 'Payment rejected',
  'payment.refund': 'Marked a payment as refunded',
  'payment.checkout_close': 'Closed unfinished checkouts',
  'payment.status_check': 'Checked a payment with PayPro',
  'payments.gateway': 'Changed payment gateway settings',
  'payments.switch': 'Changed a way to pay',
  'payments.bank_details': 'Changed the bank transfer details',
  'payments.alert_emails': 'Changed who gets payment alerts',
  'reconciliation.import': 'Uploaded a gateway file',
  'reconciliation.transfer': 'Recorded a bank transfer',
  'reconciliation.bank_import': 'Uploaded a bank statement',
  'settlement.credit_add': 'Added a bank credit',
  'settlement.deduction_add': 'Added a settlement deduction line',
  'settlement.deduction_remove': 'Removed a settlement deduction line',
  'settlement.link': 'Linked a bank credit by hand',
  'settlement.unlink': 'Unlinked a bank credit',
  'settlement.link_reset': 'Put a bank credit back to automatic matching',
  'settlement.ignore': 'Marked a bank credit as not a sale',

  // Staff
  'staff.create': 'Added to staff',
  'staff.remove': 'Removed from staff',
  'staff.role_change': 'Staff role changed',
  'staff.grant_existing': 'Given a staff role',
  'staff.invite_resend': 'Staff invite sent again',
  'staff.suspend': 'Staff access suspended',
  'staff.reactivate': 'Staff access restored',
  'staff.signup_credit': 'Sign-up credited to a staff member',
  'staff.signup_claim': 'Staff claimed this sign-up',
  'staff.signup_claim_approve': 'Staff sign-up claim approved',
  'staff.signup_claim_reject': 'Staff sign-up claim rejected',
  'staff.targets_set': 'Set monthly sign-up targets',
  'staff.target_list': 'Changed who has a sign-up target',
  'staff.my_signups_open': 'Opened My sign-ups',
  'staff.my_signups_whatsapp': 'Sent a WhatsApp from My sign-ups',
  'mfa.enroll': 'Set up two-factor',
  'mfa.reset': 'Two-factor reset',
  'mfa.backup_used': 'Used a backup code',
  'mfa.regenerate': 'Made new backup codes',
  'outreach.contact_logged': 'Logged a call or message',
  'outreach.featured_whatsapp_sent': 'Sent the Featured tuitions WhatsApp',

  // Tuitions
  'job.post': 'Posted a tuition',
  'job.edit': 'Edited a tuition',
  'job.close': 'Closed a tuition',
  'job.remove': 'Removed a tuition',
  'job.unfeature': 'Took the Featured tag off a tuition',
  'job.pause': 'Paused a tuition',
  'job.resume': 'Resumed a tuition',
  'job.refresh': 'Moved a tuition back to the top',
  'job.merge': 'Merged a repeated tuition into the original',
  'job.city_correct': 'Corrected a tuition’s city',
  'job.contact_number': 'Added the parent’s contact number',
  'job.contact_message': 'Messaged a tuition contact',
  'applicants.forward': 'Sent applicants to the parent',
  'applicants.outcome': 'Recorded the result with the parent',

  // Places and search
  'location.area_add': 'Added an area',
  'location.area_keep': 'Kept an area as its own',
  'location.alias': 'Saved a spelling of an area',
  'location.not_area': 'Marked a place as not an area',
  'location.landmark': 'Saved a block or landmark',
  'location.run_review': 'Reviewed an added area',
  'location.undo': 'Undid an area change',
  'search.synonym': 'Added a search word',
  'search.synonym_remove': 'Removed a search word',
  'search.ignore': 'Ignored an unmet search',
  'search.subject_add': 'Added a new subject from a search',
  'search.link_school': 'Linked a search to a school',
  'search_unmet.done': 'Marked an unmet search as done',
  'taxonomy.core': 'Changed a level’s main subjects',
  'taxonomy.search_words': 'Changed search words for a subject',
  'taxonomy.title_name': 'Changed a short name for blog titles',
  'taxonomy.urdu_name': 'Changed a subject’s Urdu name',
  'indexing.skip_not_tuition': 'Stopped Google notices for pages that are not tuitions',

  // Blog, ads and settings
  'blog.generate': 'Wrote a blog draft with AI',
  'blog.generate_test': 'Wrote a test blog draft with AI',
  'blog.fix_ai': 'Asked the AI to fix a blog draft',
  'blog.fix_published': 'Corrected a published blog post',
  'blog.fix_redirect_links': 'Updated old links in blog posts',
  'blog.rename_fee': 'Updated the fee name in blog posts',
  'blog.approve': 'Approved a blog post',
  'blog.publish': 'Published a blog post',
  'blog.schedule': 'Scheduled a blog post',
  'blog.unpublish': 'Unpublished a blog post',
  'blog.delete': 'Deleted a blog post',
  'blog.cover_generate': 'Made a blog cover',
  'blog.queue_dismiss': 'Dismissed a blog topic',
  'notifications.fix_redirect_links': 'Updated old links in notifications',
  'ad.create': 'Created an ad',
  'ad.edit': 'Edited an ad',
  'ad.delete': 'Deleted an ad',
  'ad.status': 'Changed an ad’s status',
  'social.generate': 'Made a social media post',
  'settings.update': 'Changed a site setting',
  'onboarding.mode': 'Changed the tutor sign-up steps setting',
  'sms.test': 'Sent a test SMS',
}

/** Actions read with the staff member's name first, and no "by …" line. */
export const ACTOR_FIRST: Record<string, string> = {
  'staff.my_signups_open': 'opened My sign-ups',
  'staff.my_signups_whatsapp': 'sent a WhatsApp from My sign-ups',
}

/**
 * The words for a code with no name of its own: never shown with underscores
 * or dots. A new action the table does not know yet reads "Staff action" plus
 * its words, so it is at least plain text until it is named.
 */
export function plainWords(code: string): string {
  const words = (code ?? '')
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  if (!words) return 'Staff action'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The timeline name of an admin action (without any item detail). */
export function auditLabel(action: string): string {
  const key = (action ?? '').trim()
  return AUDIT_LABELS[key] ?? plainWords(key)
}

/** "Aqsa sent a WhatsApp from My sign-ups", or null when the action is not one of those. */
export function actorFirstSentence(action: string, actorName: string | null): string | null {
  const tail = ACTOR_FIRST[(action ?? '').trim()]
  if (!tail) return null
  return `${actorName?.trim() || 'A staff member'} ${tail}`
}

/** A label is plain when it has no underscore, no dotted code and no camelCase word. */
export function isPlainLabel(label: string): boolean {
  if (!label.trim()) return false
  if (label.includes('_')) return false
  if (/[a-z]\.[a-z]/i.test(label)) return false
  if (/\b[a-z]+[A-Z][a-zA-Z]*\b/.test(label)) return false
  return true
}
