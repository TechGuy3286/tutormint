-- 223_edit_profile_wording.sql  (owner, 4 Nov 2026)
--
-- The members' "Settings" page is now called "Edit Profile" (its address is
-- unchanged). Three stored member-facing templates named it: the exact words
-- are swapped, nothing else in them changes. Re-runnable (a second run finds
-- nothing to replace). No row is deleted.

update public.admin_message_templates
   set body = replace(body, 'Please open Settings and upload', 'Please open Edit Profile and upload')
 where key in ('cnic_unclear', 'video_rerecord')
   and body like '%Please open Settings and upload%';

update public.admin_message_templates
   set body = replace(body, 'you can add it in Settings, under Contact details', 'you can add it in Edit Profile, under Your name and WhatsApp')
 where key = 'no_whatsapp'
   and body like '%you can add it in Settings, under Contact details%';
