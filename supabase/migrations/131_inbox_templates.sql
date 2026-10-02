-- 131_inbox_templates.sql (PR105 §6)
--
-- Three Team-inbox templates for the tags that had none — No WhatsApp number,
-- Waiting for staff approval, Fee not paid. Plain, warm, short, English with
-- Urdu underneath; no promise of tuitions or income, no stats. {name} fills in.
-- The fee template names NO amount. ON CONFLICT DO NOTHING so an owner edit via
-- "Edit templates" is never overwritten by a re-run.

insert into public.admin_message_templates (key, title, subject, body) values
(
  'no_whatsapp',
  'Add your WhatsApp number',
  'Add your WhatsApp number',
  E'Hi {name},\n\nParents reach tutors on WhatsApp, and we don''t have a number for you yet. Please add your WhatsApp number so they can contact you — you can add it in Settings, under Contact details.\n\nThank you,\nThe TutorMint Team\n\n— — —\n\nالسلام علیکم {name}،\n\nوالدین ٹیوٹرز سے واٹس ایپ پر رابطہ کرتے ہیں، اور ابھی ہمارے پاس آپ کا نمبر موجود نہیں۔ براہِ کرم اپنا واٹس ایپ نمبر شامل کریں تاکہ وہ آپ سے رابطہ کر سکیں — آپ یہ سیٹنگز میں رابطہ کی تفصیلات کے نیچے شامل کر سکتے ہیں۔\n\nشکریہ،\nٹیوٹر منٹ ٹیم'
),
(
  'awaiting_approval',
  'Your documents are being reviewed',
  'Your documents are being reviewed',
  E'Hi {name},\n\nThank you for sending your documents. Our team is reviewing them now. You don''t need to do anything right now — we''ll let you know as soon as the review is done.\n\nThe TutorMint Team\n\n— — —\n\nالسلام علیکم {name}،\n\nاپنے کاغذات بھیجنے کا شکریہ۔ ہماری ٹیم ان کا جائزہ لے رہی ہے۔ اس وقت آپ کو کچھ کرنے کی ضرورت نہیں — جائزہ مکمل ہوتے ہی ہم آپ کو اطلاع دے دیں گے۔\n\nٹیوٹر منٹ ٹیم'
),
(
  'fee_not_paid',
  'One step left to get verified',
  'One step left to get verified',
  E'Hi {name},\n\nYou''re almost there. The one-time verification fee is the last step to become a verified tutor. You can complete it from the Get verified step in your profile.\n\nThe TutorMint Team\n\n— — —\n\nالسلام علیکم {name}،\n\nآپ بس ایک قدم کی دوری پر ہیں۔ تصدیق شدہ ٹیوٹر بننے کے لیے ایک بار کی ویریفیکیشن فیس آخری مرحلہ ہے۔ آپ اسے اپنی پروفائل میں ”تصدیق کروائیں“ کے مرحلے سے مکمل کر سکتے ہیں۔\n\nٹیوٹر منٹ ٹیم'
)
on conflict (key) do nothing;
