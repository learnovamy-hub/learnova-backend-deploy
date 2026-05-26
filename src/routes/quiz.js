import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/database.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOptions(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const letters = ['A', 'B', 'C', 'D'];
    return Object.fromEntries(raw.slice(0, 4).map((v, i) => [letters[i], String(v)]));
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function normaliseAnswer(answer) {
  if (typeof answer === 'number') return answer; // 0-based index
  if (typeof answer === 'string') {
    const upper = answer.trim().toUpperCase();
    const idx = ['A', 'B', 'C', 'D'].indexOf(upper);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

// ── POST /api/quiz/generate ───────────────────────────────────────────────────
// Pull questions from concept_chunks for topics covered this session.
// Creates pending quiz_results rows (student_answer = null).

router.post('/generate', async (req, res) => {
  try {
    const { student_id, session_id, subject, form, topics_covered = [] } = req.body;
    if (!student_id || !session_id || !subject) {
      return res.status(400).json({ error: 'student_id, session_id, subject required' });
    }

    let chunks = [];

    // Priority 1: chunks for topics covered this session
    if (topics_covered.length > 0) {
      const { data } = await supabase
        .from('concept_chunks')
        .select('id, topic, check_in_question, check_in_options, check_in_answer, check_in_explanation, difficulty_level')
        .eq('subject', subject)
        .in('topic', topics_covered)
        .not('check_in_question', 'is', null)
        .order('difficulty_level', { ascending: true })
        .limit(7);
      chunks = data || [];
    }

    // Priority 2: supplement from same subject if fewer than 5
    if (chunks.length < 5) {
      const existingIds = chunks.map(c => c.id);
      const needed = 7 - chunks.length;
      const query = supabase
        .from('concept_chunks')
        .select('id, topic, check_in_question, check_in_options, check_in_answer, check_in_explanation, difficulty_level')
        .eq('subject', subject)
        .not('check_in_question', 'is', null)
        .order('difficulty_level', { ascending: false })
        .limit(needed);
      if (existingIds.length > 0) query.not('id', 'in', `(${existingIds.join(',')})`);
      const { data: extra } = await query;
      if (extra) chunks = [...chunks, ...extra];
    }

    // Shuffle and cap at 7, min 3
    chunks = chunks.sort(() => Math.random() - 0.5).slice(0, 7);
    if (chunks.length < 3) {
      return res.status(404).json({ error: 'Not enough quiz questions for this topic yet.' });
    }

    // Build question objects and save pending rows
    const questions = chunks.map((c, idx) => {
      const options = formatOptions(c.check_in_options);
      const correctIndex = normaliseAnswer(c.check_in_answer);
      const letters = ['A', 'B', 'C', 'D'];
      return {
        question_number: idx + 1,
        chunk_id: c.id,
        topic: c.topic,
        question: c.check_in_question,
        options,
        correct_answer: correctIndex,
        correct_letter: letters[correctIndex] || 'A',
        explanation: c.check_in_explanation || '',
        difficulty_level: c.difficulty_level,
      };
    });

    // Save pending rows to quiz_results
    const rows = questions.map(q => ({
      student_id,
      session_id,
      subject,
      form: form || 'Form 4',
      topic: q.topic,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      student_answer: null,
      is_correct: null,
      concept_chunk_id: q.chunk_id,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('quiz_results')
      .insert(rows)
      .select('id');

    if (insertErr) {
      console.error('[Quiz] Insert error:', insertErr.message);
      // Return questions even if DB insert fails — don't block student
    }

    // Attach DB ids to questions
    if (inserted) {
      inserted.forEach((row, i) => { if (questions[i]) questions[i].result_id = row.id; });
    }

    return res.json({ questions, total: questions.length, session_id });
  } catch (err) {
    console.error('[Quiz] Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quiz/answer ─────────────────────────────────────────────────────
// Grade one answer. Update quiz_results row.

router.post('/answer', async (req, res) => {
  try {
    const { result_id, student_id, session_id, chunk_id, student_answer, time_taken_seconds } = req.body;
    if (student_answer === undefined || student_answer === null) {
      return res.status(400).json({ error: 'student_answer required' });
    }

    // Fetch the pending row to get correct_answer
    let row = null;
    if (result_id) {
      const { data } = await supabase
        .from('quiz_results')
        .select('correct_answer, question, options, topic')
        .eq('id', result_id)
        .maybeSingle();
      row = data;
    } else if (chunk_id && session_id) {
      const { data } = await supabase
        .from('quiz_results')
        .select('id, correct_answer, question, options, topic')
        .eq('session_id', session_id)
        .eq('concept_chunk_id', chunk_id)
        .is('student_answer', null)
        .maybeSingle();
      row = data;
    }

    if (!row) {
      return res.status(404).json({ error: 'Quiz question not found.' });
    }

    const answerIndex = normaliseAnswer(student_answer);
    const is_correct = answerIndex === row.correct_answer;

    // Update the row
    const updateTarget = result_id || row.id;
    if (updateTarget) {
      await supabase
        .from('quiz_results')
        .update({ student_answer: answerIndex, is_correct, time_taken_seconds: time_taken_seconds || null })
        .eq('id', updateTarget);
    }

    // Format response message
    const letters = ['A', 'B', 'C', 'D'];
    const correctLetter = letters[row.correct_answer] || 'A';
    const studentLetter = letters[answerIndex] || '?';
    const options = row.options || {};

    let message;
    if (is_correct) {
      message = `Betul! Jawapan ${correctLetter} adalah tepat.`;
    } else {
      const correctText = options[correctLetter] || '';
      message = `Bukan ${studentLetter}. Jawapan yang betul ialah ${correctLetter}${correctText ? ' — ' + correctText : ''}.`;
    }

    return res.json({ is_correct, correct_answer: row.correct_answer, correct_letter: correctLetter, message });
  } catch (err) {
    console.error('[Quiz] Answer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quiz/complete ───────────────────────────────────────────────────
// Finalize session. Calculate score, identify weak/strong topics, save session_summary.

router.post('/complete', async (req, res) => {
  try {
    const { student_id, session_id, subject, form, topics_covered = [], session_duration_minutes } = req.body;
    if (!student_id || !session_id) {
      return res.status(400).json({ error: 'student_id and session_id required' });
    }

    const { data: results } = await supabase
      .from('quiz_results')
      .select('topic, is_correct, question, student_answer')
      .eq('session_id', session_id)
      .eq('student_id', student_id)
      .not('student_answer', 'is', null);

    const total = (results || []).length;
    const correct = (results || []).filter(r => r.is_correct).length;
    const score_percent = total > 0 ? Math.round((correct / total) * 100 * 100) / 100 : 0;

    // Aggregate by topic
    const topicMap = {};
    for (const r of results || []) {
      if (!topicMap[r.topic]) topicMap[r.topic] = { correct: 0, total: 0 };
      topicMap[r.topic].total++;
      if (r.is_correct) topicMap[r.topic].correct++;
    }
    const strong_topics = Object.entries(topicMap).filter(([, v]) => v.correct / v.total >= 0.6).map(([k]) => k);
    const weak_topics = Object.entries(topicMap).filter(([, v]) => v.correct / v.total < 0.6).map(([k]) => k);

    // Save session_summary
    await supabase.from('session_summary').upsert({
      student_id,
      session_id,
      subject: subject || '',
      form: form || 'Form 4',
      topics_covered,
      session_duration_minutes: session_duration_minutes || null,
      quiz_attempted: total,
      quiz_correct: correct,
      quiz_score_percent: score_percent,
      weak_topics,
      strong_topics,
      session_date: new Date().toISOString().split('T')[0],
    }, { onConflict: 'session_id' });

    // Generate BM result message
    let resultMsg = `Kuiz selesai! Kamu dapat ${correct}/${total} (${score_percent}%).`;
    if (score_percent >= 80) resultMsg += ' Cemerlang! Teruskan semangat tu.';
    else if (score_percent >= 60) resultMsg += ' Bagus! Masih ada ruang untuk penambahbaikan.';
    else resultMsg += ' Jangan risau — ulang kaji topik yang lemah dan cuba lagi.';

    return res.json({ score: correct, total, score_percent, strong_topics, weak_topics, message: resultMsg });
  } catch (err) {
    console.error('[Quiz] Complete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/quiz/history/:studentId ─────────────────────────────────────────
// Quiz history for a student — used by parent dashboard.

router.get('/history/:studentId', async (req, res) => {
  try {
    const { data } = await supabase
      .from('session_summary')
      .select('session_id, subject, form, topics_covered, session_duration_minutes, quiz_attempted, quiz_correct, quiz_score_percent, weak_topics, strong_topics, session_date, created_at')
      .eq('student_id', req.params.studentId)
      .order('session_date', { ascending: false })
      .limit(30);

    res.json({ history: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
