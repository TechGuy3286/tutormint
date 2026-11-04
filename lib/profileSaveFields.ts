// lib/profileSaveFields.ts
//
// The columns /api/profile/save lets a member write, per table. PURE (no server
// imports) so the route and the Edit Profile test read the same lists.
//
// `city` is NOT here on purpose: the route writes it by role (tutor →
// tutor_profiles.city mirrored to profiles.city; parent → profiles.city).

export const PROFILE_FIELDS = new Set(['full_name', 'province', 'address', 'cnic_number', 'whatsapp'])
export const TUTOR_FIELDS = new Set([
  'gender', 'area', 'avatar_url', 'headline', 'bio',
  'experience_years', 'hourly_rate_pkr', 'fee_min_pkr', 'fee_max_pkr', 'teaching_mode', 'job_types', 'online_platforms', 'degrees',
])
