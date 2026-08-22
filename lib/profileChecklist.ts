export function calculateTutorProfileCompletion(profile: any) {
  let score = 0;
  const checklist = {
    hasImage: !!profile?.image_url,
    hasTitle: !!profile?.title,
    hasBio: !!profile?.bio,
    hasSubjects: profile?.subjects && profile.subjects.length > 0,
    hasDeviceVerified: !!profile?.device_token // Mobile app selfie/login flag
  };

  if (checklist.hasImage) score += 20;
  if (checklist.hasTitle) score += 20;
  if (checklist.hasBio) score += 20;
  if (checklist.hasSubjects) score += 20;
  if (checklist.hasDeviceVerified) score += 20;

  return { score, checklist };
}

export function calculateParentProfileCompletion(profile: any) {
  let score = 0;
  const checklist = {
    hasName: !!profile?.full_name,
    hasPhone: !!profile?.phone_number,
    hasCity: !!profile?.city,
    hasArea: !!profile?.area,
    hasStudentGrade: !!profile?.student_grade
  };

  if (checklist.hasName) score += 20;
  if (checklist.hasPhone) score += 20;
  if (checklist.hasCity) score += 20;
  if (checklist.hasArea) score += 20;
  if (checklist.hasStudentGrade) score += 20;

  return { score, checklist };
}