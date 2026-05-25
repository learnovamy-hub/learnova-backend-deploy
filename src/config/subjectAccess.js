export const ALWAYS_FREE = ['Bahasa Malaysia'];

export const ALL_SUBJECTS = [
  'Mathematics', 'Add Maths', 'Physics', 'Biology', 'Chemistry',
  'Geography', 'Sejarah', 'Bahasa Malaysia', 'English',
  'Pendidikan Islam', 'Pendidikan Moral', 'Accounts', 'Economics',
];

// Prices in MYR cents
export const SUBJECT_PRICES_MYR = {
  single: 1500,   // RM15/subject/month
  bundle3: 3500,  // RM35/3 subjects
  bundleAll: 6900, // RM69/all subjects
};

/**
 * Returns the subject_access rows to insert for a new student at registration.
 * BM is always free. First chosen subject gets a 7-day trial.
 */
export function getRegistrationGrants(studentId, chosenSubjects = [], trialDays = 7) {
  const now = new Date();
  const trialExpiry = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = [];

  // Always grant BM for free
  const bm = 'Bahasa Malaysia';
  rows.push({
    student_id: studentId,
    subject: bm,
    access_type: 'free',
    granted_at: now.toISOString(),
    expires_at: null,
  });

  // First chosen subject (non-BM) → 7-day trial
  const nonBm = chosenSubjects.filter(s => s !== bm);
  if (nonBm.length > 0) {
    rows.push({
      student_id: studentId,
      subject: nonBm[0],
      access_type: 'trial',
      granted_at: now.toISOString(),
      expires_at: trialExpiry,
    });
  }

  return rows;
}
