import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/database.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// POST /api/session-quiz/generate
// Called at lesson start — pre-generates 5-7 questions silently in background
router.post('/generate', async (req, res) => {
  try {
    const { student_id, subject, topic } = req.body;
    if (!student_id || !subject) {
      return res.status(400).json({ error: 'student_id and subject required' });
    }

    // Delete any previous unfinished session questions for this student+subject
    await supabase
      .from('session_quiz_questions')
      .delete()
      .eq('student_id', student_id)
      .eq('subject', subject);

    const topicContext = topic ? `on the topic of "${topic}"` : '';
    const prompt = `You are an SPM exam question generator for Malaysian secondary school students.

Generate exactly 6 multiple-choice questions for ${subject} ${topicContext}.

Rules:
- Questions must be appropriate for SPM Form 4-5 level
- Each question has exactly 4 options: A, B, C, D
- Only one correct answer per question
- Include a brief explanation for the correct answer
- Mix difficulty: 2 easy, 3 medium, 1 hard
- Questions must test conceptual understanding, not just memorisation

Respond ONLY with a JSON array, no markdown, no preamble:
[
  {
    "question": "Question text here?",
    "options": {"A": "option", "B": "option", "C": "option", "D": "option"},
    "correct_answer": "A",
    "explanation": "Brief explanation why A is correct"
  }
]`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const questions = JSON.parse(clean);

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Invalid questions format from Claude');
    }

    // Store generated questions
    const rows = questions.map(q => ({
      student_id,
      subject,
      topic: topic || null,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
    }));

    const { error: insertError } = await supabase
      .from('session_quiz_questions')
      .insert(rows);

    if (insertError) throw insertError;

    res.json({ success: true, count: rows.length });
  } catch (err) {
    console.error('Session quiz generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/session-quiz/:studentId/:subject
// Fetch pre-generated questions for this student+subject
router.get('/:studentId/:subject', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('session_quiz_questions')
      .select('id, question, options, correct_answer, explanation, topic')
      .eq('student_id', req.params.studentId)
      .eq('subject', decodeURIComponent(req.params.subject))
      .order('generated_at', { ascending: false })
      .limit(7);

    if (error) throw error;
    res.json({ questions: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/session-quiz/submit
// Save results + trigger parent notification
router.post('/submit', async (req, res) => {
  try {
    const { student_id, subject, topic, answers, questions } = req.body;

    let score = 0;
    const gradedAnswers = questions.map(q => {
      const studentAnswer = answers[q.id] || '';
      const correct = studentAnswer === q.correct_answer;
      if (correct) score++;
      return {
        question_id: q.id,
        question: q.question,
        student_answer: studentAnswer,
        correct_answer: q.correct_answer,
        correct,
        explanation: q.explanation,
      };
    });

    const total = questions.length;
    const percentage = Math.round((score / total) * 100);

    // Save result
    const { data: result, error: resultError } = await supabase
      .from('session_quiz_results')
      .insert([{
        student_id,
        subject,
        topic,
        score,
        total,
        percentage,
        answers: gradedAnswers,
      }])
      .select()
      .single();

    if (resultError) throw resultError;

    // Get student info for parent notification
    const { data: student } = await supabase
      .from('students')
      .select('full_name, parent_email')
      .eq('id', student_id)
      .maybeSingle();

    // Fire parent notification in background (non-blocking)
    if (student?.parent_email) {
      _notifyParent({
        parentEmail: student.parent_email,
        studentName: student.full_name,
        studentId: student_id,
        subject,
        topic,
        score,
        total,
        percentage,
        gradedAnswers,
      }).catch(e => console.error('Parent notify error:', e));
    }

    res.json({ success: true, score, total, percentage, answers: gradedAnswers });
  } catch (err) {
    console.error('Session quiz submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function _notifyParent({ parentEmail, studentName, studentId, subject, topic, score, total, percentage, gradedAnswers }) {
  const weakAreas = gradedAnswers.filter(a => !a.correct).map(a => a.question).slice(0, 2);
  const weakText = weakAreas.length > 0 ? `Areas to review: ${weakAreas.join('; ')}` : 'Great performance across all questions!';

  // Generate plain-language summary via Claude Haiku
  const summary = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Write a warm 2-sentence parent update. Student: ${studentName}, Subject: ${subject}, Topic: ${topic || subject}, Score: ${score}/${total} (${percentage}%). Keep it encouraging and specific. No greeting needed.`
    }]
  });

  const summaryText = summary.content[0].text.trim();

  // Store notification for parent dashboard
  await supabase.from('parent_notifications').insert([{
    parent_email: parentEmail,
    student_name: studentName,
    student_id: studentId,
    subject,
    topic,
    score,
    total,
    percentage,
    summary: summaryText,
    weak_areas: weakAreas,
    notified_at: new Date().toISOString(),
  }]).catch(() => {});
}

export default router;