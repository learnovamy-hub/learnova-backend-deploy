import { supabase } from '../config/database.js';

/**
 * Middleware factory: checks whether a student can access a given subject.
 * Usage: router.get('/something', checkSubjectAccess('subject', 'topic'), handler)
 * The subject/topic can be read from req.query, req.params, or req.body.
 *
 * Trial mode (platform_settings.trial_mode_active = 'true') bypasses all checks.
 */
export function checkSubjectAccess(subjectField = 'subject') {
  return async (req, res, next) => {
    try {
      // 1. Check trial/God Mode
      const { data: setting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'trial_mode_active')
        .maybeSingle();

      if (setting?.value === 'true') return next();

      // 2. Resolve student ID (from JWT or body/query)
      const studentId =
        req.user?.userId ||
        req.body?.student_id ||
        req.query?.student_id ||
        req.headers['x-student-id'];

      if (!studentId) return res.status(401).json({ error: 'Student not identified' });

      // 3. Resolve subject being requested
      const subject =
        req.body?.[subjectField] ||
        req.query?.[subjectField] ||
        req.params?.[subjectField];

      if (!subject) return next(); // no subject gating needed

      // 4. Check subject_access table
      const { data: access } = await supabase
        .from('subject_access')
        .select('access_type, expires_at')
        .eq('student_id', studentId)
        .eq('subject', subject)
        .maybeSingle();

      if (!access) {
        return res.status(403).json({
          error: 'subject_locked',
          message: `Subjek ${subject} perlu dibuka. Mulakan percubaan percuma atau langgan sekarang.`,
          subject,
        });
      }

      // 5. Check expiry for trial access
      if (access.access_type === 'trial' && access.expires_at) {
        const expired = new Date(access.expires_at) < new Date();
        if (expired) {
          return res.status(403).json({
            error: 'trial_expired',
            message: `Percubaan percuma ${subject} telah tamat. Langgan untuk teruskan pembelajaran.`,
            subject,
          });
        }
      }

      next();
    } catch (err) {
      console.error('[checkSubjectAccess]', err.message);
      next(); // fail open — don't block students on DB errors
    }
  };
}
