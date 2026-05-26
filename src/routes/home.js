import express from 'express';
import { authMiddleware } from '../config/auth.js';
import { supabase } from '../config/database.js';

const router = express.Router();

const SPM_DATE = new Date('2026-11-12');

const QUOTES = [
  { text: 'Kejayaan bukan milik orang yang bijak sahaja, tetapi milik orang yang berusaha keras.', author: 'Peribahasa Melayu' },
  { text: 'Ilmu tanpa amal seperti pokok tidak berbuah.', author: 'Peribahasa Melayu' },
  { text: 'Berakit-rakit ke hulu, berenang-renang ke tepian; bersakit-sakit dahulu, bersenang-senang kemudian.', author: 'Peribahasa Melayu' },
  { text: 'Education is the most powerful weapon which you can use to change the world.', author: 'Nelson Mandela' },
  { text: 'Jangan lihat ke belakang, pandang ke hadapan dengan penuh keyakinan.', author: 'Tun Mahathir Mohamad' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Usaha itu penting, tetapi strategi yang betul lebih penting lagi.', author: 'Peribahasa Moden' },
  { text: 'Kejayaan SPM bukan tentang bakat, tetapi tentang disiplin harian.', author: 'Learnova' },
  { text: 'Setiap topik yang kamu kuasai hari ini adalah satu langkah lebih dekat ke universiti impian.', author: 'Learnova' },
  { text: 'Do not watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'Belajar bukan untuk lulus peperiksaan, tetapi untuk membina masa depan yang lebih cerah.', author: 'Peribahasa Moden' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { text: 'Kepintaran tanpa usaha umpama bintang yang bersinar di siang hari.', author: 'Peribahasa Melayu' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Setiap minit yang kamu gunakan untuk belajar sekarang akan menjimatkan jam penyesalan kemudian.', author: 'Learnova' },
  { text: 'In the middle of every difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'Bukan semua orang yang berjaya adalah pandai, tetapi semua orang yang berusaha pasti berjaya.', author: 'Peribahasa Melayu' },
  { text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', author: 'Winston Churchill' },
  { text: 'Kamu tidak perlu menjadi yang terbaik, cukup menjadi lebih baik dari semalam.', author: 'Learnova' },
  { text: 'The beautiful thing about learning is that no one can take it away from you.', author: 'B.B. King' },
  { text: 'Nak seribu daya, tak nak seribu dalih.', author: 'Peribahasa Melayu' },
  { text: 'Your only limit is your mind.', author: 'Unknown' },
  { text: 'Hargai setiap detik yang ada, kerana masa tidak akan berundur.', author: 'Peribahasa Melayu' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'Pelajar yang berjaya bukan yang paling bijak, tetapi yang paling berdisiplin.', author: 'Learnova' },
  { text: 'The harder you work for something, the greater you will feel when you achieve it.', author: 'Unknown' },
  { text: 'Ilmu adalah warisan yang tidak akan habis dibahagi-bahagi.', author: 'Peribahasa Melayu' },
  { text: 'Dream big, work hard, stay focused, and surround yourself with good people.', author: 'Unknown' },
  { text: 'Masa adalah emas; jangan bazirkan ia.', author: 'Peribahasa Melayu' },
  { text: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt' },
];

function getMonday(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function computeStreak(sessions) {
  const now = new Date();
  const today = now.toISOString().substring(0, 10);
  const uniqueDates = [...new Set(
    (sessions || []).map(s => ((s.created_at || s.session_start) || '').substring(0, 10)).filter(Boolean)
  )].sort().reverse();

  let streak = 0;
  let checkDate = today;
  for (const date of uniqueDates) {
    if (date === checkDate) {
      streak++;
      const prev = new Date(checkDate);
      prev.setDate(prev.getDate() - 1);
      checkDate = prev.toISOString().substring(0, 10);
    } else if (date < checkDate) {
      break;
    }
  }

  // Week dots (Mon–Sun of current week)
  const monday = getMonday(now);
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDays.push(uniqueDates.includes(d.toISOString().substring(0, 10)));
  }

  return { days: streak, week_days: weekDays };
}

/**
 * GET /api/home/dashboard
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 35);
  const today = now.toISOString().split('T')[0];

  try {
    const [sessionsWeek, sessionsMonth, quizWeek, userRow, newsRows] = await Promise.all([
      supabase.from('session_logs')
        .select('subject, topic, session_start, session_end, duration_minutes, created_at')
        .eq('student_id', userId)
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false }),

      supabase.from('session_logs')
        .select('created_at')
        .eq('student_id', userId)
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false }),

      supabase.from('quiz_results')
        .select('percentage, created_at')
        .eq('user_id', userId)
        .gte('created_at', weekAgo.toISOString()),

      supabase.from('users')
        .select('created_at')
        .eq('id', userId)
        .single(),

      supabase.from('daily_content')
        .select('id, content_type, title, body, source, publish_date')
        .lte('publish_date', today)
        .or(`expires_date.is.null,expires_date.gte.${today}`)
        .order('publish_date', { ascending: false })
        .limit(6),
    ]);

    // SPM countdown
    const spmDays = Math.max(0, Math.ceil((SPM_DATE - now) / 86400000));
    const signupDate = userRow.data ? new Date(userRow.data.created_at) : new Date(now - 30 * 86400000);
    const totalPrepDays = Math.max(1, Math.ceil((SPM_DATE - signupDate) / 86400000));
    const daysUsed = Math.ceil((now - signupDate) / 86400000);
    const prepPercent = Math.min(100, Math.round((daysUsed / totalPrepDays) * 100));

    // Resume last session
    const sessions = sessionsWeek.data || [];
    const lastSession = sessions[0] || null;
    const resumeSession = lastSession ? {
      subject: lastSession.subject,
      topic: lastSession.topic,
      last_seen: lastSession.created_at,
    } : null;

    // Weekly stats
    const quizzes = quizWeek.data || [];
    const studyMinutes = sessions.reduce((s, r) => s + (r.duration_minutes || 0), 0);
    const avgQuizScore = quizzes.length > 0
      ? Math.round(quizzes.reduce((s, r) => s + (r.percentage || 0), 0) / quizzes.length)
      : null;
    const topicsCompleted = new Set(sessions.map(s => s.topic).filter(Boolean)).size;

    // Weakest subject: subject with fewest sessions this week
    const subjectCounts = {};
    for (const s of sessions) {
      if (s.subject) subjectCounts[s.subject] = (subjectCounts[s.subject] || 0) + 1;
    }
    const weakestSubject = Object.keys(subjectCounts).length > 1
      ? Object.entries(subjectCounts).sort((a, b) => a[1] - b[1])[0]?.[0]
      : null;

    // Streak (uses month sessions for continuity)
    const allForStreak = [...sessions, ...(sessionsMonth.data || [])];
    const streakData = computeStreak(allForStreak);

    // Quote of the day
    const dayOfMonth = now.getDate();
    const quote = QUOTES[(dayOfMonth - 1) % QUOTES.length];

    // News
    const news = (newsRows.data || []).map(n => ({
      id: n.id,
      type: n.content_type,
      title: n.title,
      body: n.body,
      source: n.source,
      date: n.publish_date,
    }));

    res.json({
      spm_days_remaining: spmDays,
      prep_percent: prepPercent,
      resume_session: resumeSession,
      weekly_stats: {
        avg_quiz_score: avgQuizScore,
        study_minutes: studyMinutes,
        topics_completed: topicsCompleted,
        weakest_subject: weakestSubject,
      },
      streak: {
        days: streakData.days,
        week_days: streakData.week_days,
      },
      friends: [],
      daily_quote: quote,
      news,
    });
  } catch (err) {
    console.error('Home dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/home/game-chunks
 * Returns shuffled concept chunks for mini-games
 */
router.get('/game-chunks', authMiddleware, async (req, res) => {
  const { subject, limit = '10' } = req.query;
  const n = Math.min(50, Math.max(5, parseInt(limit)));
  try {
    let query = supabase.from('concept_chunks')
      .select('id, subject, topic, concept_title, concept_explanation, check_in_question, keywords')
      .not('concept_title', 'is', null)
      .not('concept_explanation', 'is', null)
      .limit(n * 6);

    if (subject) query = query.eq('subject', subject);

    const { data, error } = await query;
    if (error) throw error;

    const shuffled = (data || []).sort(() => Math.random() - 0.5).slice(0, n);
    res.json(shuffled);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
