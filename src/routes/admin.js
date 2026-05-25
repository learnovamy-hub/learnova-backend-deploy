import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'learnova-admin-jwt-2026';

// ── Admin JWT Auth ──────────────────────────────────────────────────────────
function adminAuthMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(auth.slice(7), ADMIN_JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: admin, error } = await supabase
      .from('admins')
      .select('id, email, password_hash, full_name, role')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error || !admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: admin.role },
      ADMIN_JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/setup — create first admin (only if no admins exist, requires ADMIN_SECRET header)
router.post('/setup', async (req, res) => {
  const key = req.headers['x-admin-key'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'learnova-admin-2026';
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { count } = await supabase.from('admins').select('*', { count: 'exact', head: true });
    if (count > 0) return res.status(409).json({ error: 'Admin already exists' });
    const hash = await bcrypt.hash('Principalgod', 10);
    await supabase.from('admins').insert({
      email: 'principal@test.com',
      password_hash: hash,
      full_name: 'Principal',
      role: 'principal',
    });
    res.json({ success: true, message: 'Admin created: principal@test.com / Principalgod' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/dashboard — overview stats
router.get('/dashboard', adminAuthMiddleware, async (req, res) => {
  try {
    const [{ count: students }, { count: sessions }, { data: settings }] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('session_logs').select('*', { count: 'exact', head: true }),
      supabase.from('platform_settings').select('key, value'),
    ]);
    const { data: payments } = await supabase
      .from('payments').select('amount_cents').eq('status', 'success');
    const revenue = (payments || []).reduce((sum, p) => sum + (p.amount_cents || 0), 0);
    const settingsMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
    res.json({ students, sessions, revenue_cents: revenue, settings: settingsMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings — get all platform settings
router.get('/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('platform_settings').select('key, value');
    res.json(Object.fromEntries((data || []).map(s => [s.key, s.value])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/settings — update a setting
router.patch('/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
    await supabase.from('platform_settings').upsert(
      { key, value: String(value), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/grant-access — manually grant/extend subject access for a student
router.post('/grant-access', adminAuthMiddleware, async (req, res) => {
  try {
    const { student_id, subject, access_type = 'admin_grant', days } = req.body;
    if (!student_id || !subject) return res.status(400).json({ error: 'student_id and subject required' });
    const expires_at = days
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;
    await supabase.from('subject_access').upsert(
      { student_id, subject, access_type, granted_at: new Date().toISOString(), expires_at },
      { onConflict: 'student_id,subject' }
    );
    res.json({ success: true, student_id, subject, access_type, expires_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/revoke-access
router.post('/revoke-access', adminAuthMiddleware, async (req, res) => {
  try {
    const { student_id, subject } = req.body;
    if (!student_id || !subject) return res.status(400).json({ error: 'student_id and subject required' });
    await supabase.from('subject_access').delete().eq('student_id', student_id).eq('subject', subject);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/students — list students with their subject access
router.get('/students', adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 30, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let q = supabase.from('students')
      .select('id, name, email, form_level, subjects, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data, count, error } = await q;
    if (error) throw error;

    // Fetch subject_access for these students
    const ids = (data || []).map(s => s.id);
    const { data: access } = ids.length
      ? await supabase.from('subject_access').select('student_id, subject, access_type, expires_at').in('student_id', ids)
      : { data: [] };

    const accessByStudent = {};
    for (const a of (access || [])) {
      if (!accessByStudent[a.student_id]) accessByStudent[a.student_id] = [];
      accessByStudent[a.student_id].push(a);
    }

    res.json({
      students: (data || []).map(s => ({ ...s, access: accessByStudent[s.id] || [] })),
      total: count,
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/payments — payment history
router.get('/payments', adminAuthMiddleware, async (req, res) => {
  try {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function generateQuestions(subject, topicName) {
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: 'You are a Malaysian SPM ' + subject + ' teacher. Generate 5 MCQ questions for topic: "' + topicName + '". Rules: SPM Form 4-5 level, 4 options each (A/B/C/D), mix easy/medium/hard, no textbook copying. Respond ONLY with JSON array, no markdown: [{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct_answer":"A","explanation":"...","difficulty":"easy"}]'
    }]
  });
  const text = r.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

router.post('/seed-quizzes', async (req, res) => {
  const { subject: filterSubject, limit = 50 } = req.query;
  res.json({ message: 'Quiz seeding started in background. Check Railway logs.', status: 'running' });

  try {
    let query = supabase.from('faq_cache').select('subject, topic').order('subject').order('topic');
    if (filterSubject) query = query.eq('subject', filterSubject);
    const { data: rows, error } = await query;
    if (error) { console.error('[SEED] faq_cache error:', error); return; }

    const seen = new Set();
    const pairs = [];
    for (const row of (rows || [])) {
      const key = row.subject + '|' + row.topic;
      if (!seen.has(key)) { seen.add(key); pairs.push({ subject: row.subject, topic: row.topic }); }
    }

    console.log('[SEED] Found ' + pairs.length + ' unique topics');

    for (const p of pairs.slice(0, parseInt(limit))) {
      try {
        const { data: existing } = await supabase.from('quizzes').select('id').eq('subject', p.subject).eq('topic', p.topic).maybeSingle();
        if (existing) { console.log('[SEED] Skip: ' + p.topic); continue; }

        console.log('[SEED] Generating: ' + p.subject + ' - ' + p.topic);
        const qs = await generateQuestions(p.subject, p.topic);

        const { data: quiz, error: qe } = await supabase.from('quizzes').insert([{
          title: p.topic + ' Quiz',
          topic: p.topic,
          subject: p.subject,
          question_count: qs.length,
          total_questions: qs.length,
          difficulty: 'mixed',
          is_published: true,
        }]).select().single();

        if (qe) { console.error('[SEED] Quiz insert error:', qe); continue; }

        const questionRows = qs.map(q => ({
          quiz_id: quiz.id,
          question: q.question,
          type: 'mcq',
          question_type: 'mcq',
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
        }));

        const { error: qerr } = await supabase.from('quiz_questions').insert(questionRows);
        if (qerr) { console.error('[SEED] Questions insert error:', qerr); continue; }

        console.log('[SEED] Done: ' + p.topic + ' (' + qs.length + ' Qs)');
        await new Promise(r => setTimeout(r, 800));

      } catch (err) {
        console.error('[SEED] Error for ' + p.topic + ':', err.message);
      }
    }
    console.log('[SEED] All done!');
  } catch (err) {
    console.error('[SEED] Fatal error:', err);
  }
});

router.get('/seed-quizzes/status', async (req, res) => {
  try {
    const { count: qc } = await supabase.from('quizzes').select('*', { count: 'exact', head: true });
    const { count: qqc } = await supabase.from('quiz_questions').select('*', { count: 'exact', head: true });
    const { data: bs } = await supabase.from('quizzes').select('subject');
    const sc = {};
    (bs || []).forEach(q => { sc[q.subject] = (sc[q.subject] || 0) + 1; });
    res.json({ total_quizzes: qc, total_questions: qqc, by_subject: sc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ── Quality Review API ───────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'learnova-admin-2026';

function authenticateAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// GET /api/admin/quality-review — list flagged conversations
router.get('/quality-review', authenticateAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('conversation_logs')
      .select('*')
      .eq('flagged_for_review', true)
      .order('created_at', { ascending: false })
      .limit(50);
    return res.json({ flagged: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/quality-review/:id — mark as reviewed
router.patch('/quality-review/:id', authenticateAdmin, async (req, res) => {
  try {
    const { action, notes, session_id } = req.body;
    await supabase
      .from('conversation_logs')
      .update({ flagged_for_review: false })
      .eq('id', req.params.id);
    await supabase.from('quality_reviews').insert({
      conversation_log_id: req.params.id,
      session_id: session_id || 'unknown',
      review_status: 'reviewed',
      action_taken: action || null,
      reviewer_notes: notes || null,
      reviewed_at: new Date().toISOString()
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/response-feedback — receive student feedback from Flutter
router.post('/response-feedback', async (req, res) => {
  try {
    const { conversation_log_id, student_id, session_id, rating, feedback_type, comment } = req.body;
    await supabase.from('response_feedback').insert({
      conversation_log_id: conversation_log_id || null,
      student_id: student_id || null,
      session_id: session_id || 'unknown',
      rating: rating || null,
      feedback_type: feedback_type || null,
      comment: comment || null,
    });
    // Auto-flag the original log for review on negative feedback
    if (feedback_type && feedback_type !== 'helpful' && conversation_log_id) {
      await supabase.from('conversation_logs')
        .update({ flagged_for_review: true, flag_reason: `student_reported_${feedback_type}` })
        .eq('id', conversation_log_id);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/seed-faqs',async(req,res)=>{const{subject:fs2,form=5}=req.query;res.json({message:'FAQ seeding started',status:'running'});const T={'Mathematics':['Progressions','Linear Law','Integration','Vectors','Trigonometric Functions','Probability','Probability Distributions'],'Add Maths':['Progressions','Linear Law','Integration','Vectors','Probability','Kinematics'],'Physics':['Waves','Electricity','Electromagnetism','Electronics','Nuclear Physics'],'Chemistry':['Thermochemistry','Electrochemistry','Synthetic Polymers','Rate of Reaction'],'Biology':['Transport in Humans','Reproduction','Growth','Inheritance','Variation'],'English':['Essay Writing','Literature','Grammar'],'Bahasa Malaysia':['Penulisan','Komsas','Tatabahasa'],'Sejarah':['Malaysia dalam Era Globalisasi','Pembangunan Negara']};try{const subs=fs2?[fs2]:Object.keys(T);let tot=0;for(const sub of subs){for(const top of(T[sub]||[])){try{const{data:ex}=await supabase.from('faq_cache').select('id').eq('subject',sub).eq('topic',top).eq('form_level',String(form)).limit(1);if(ex&&ex.length>0){console.log('[FAQ] Skip:',top);continue;}console.log('[FAQ] Gen:',sub,'F'+form,top);const p='Malaysian SPM '+sub+' Form '+form+' teacher. Generate 8 student FAQ for topic: '+top+'. Return ONLY JSON array: [{question,answer,topic,subject}]';const rv=await anthropic.messages.create({model:'claude-sonnet-4-5',max_tokens:2000,messages:[{role:'user',content:p}]});const faqs=JSON.parse(rv.content[0].text.trim().replace(/`json|`/g,'').trim());if(!Array.isArray(faqs))continue;const rows=faqs.map(f=>({subject:sub,topic:top,question:f.question,answer:f.answer,form_level:String(form),source:'claude_ai',related_questions:[]}));await supabase.from('faq_cache').upsert(rows,{onConflict:'subject,question',ignoreDuplicates:true});tot+=faqs.length;console.log('[FAQ] Done:',top,faqs.length);await new Promise(r=>setTimeout(r,800));}catch(e){console.error('[FAQ] Err:',top,e.message);}}}console.log('[FAQ] Total:',tot);}catch(e){console.error('[FAQ] Fatal:',e);}});
export default router;


