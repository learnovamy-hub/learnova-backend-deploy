import express from 'express';
import { getConversationLimit } from '../utils/conversation_limiter.js';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/database.js';
import { PedagogyEngine, buildMasterSystemPrompt, ResponseClassifier } from '../pedagogy/index.js';

const router = express.Router();
const LANGUAGE_TTS = {
  en: 'en-US', ms: 'ms-MY', bm: 'ms-MY', zh: 'zh-CN', ta: 'ta-IN',
};
function getTtsLang(lang) { return LANGUAGE_TTS[lang] || 'ms-MY'; }

const MONOLINGUAL_SUBJECTS = ['Bahasa Malaysia', 'BM', 'Sejarah', 'History'];
const ENGLISH_SUBJECTS = [
  'English', 'English Literature',
  'Geography',
  'Mathematics', 'Add Mathematics', 'Add Maths',
  'Physics', 'Chemistry', 'Biology',
  'Science',
];

const ENGLISH_REQUEST_TRIGGERS = [
  /\benglish\s*(please|je|only|sahaja)?\b/i,
  /\bin\s+english\b/i,
  /\bexplain\s+in\s+english\b/i,
  /\bBI\s+please\b/i,
  /\bboleh\s+(english|BI)\b/i,
  /\benglish\s+mode\b/i,
];

function detectEnglishRequest(message) {
  if (!message) return false;
  return ENGLISH_REQUEST_TRIGGERS.some(re => re.test(message));
}

function getEffectiveLanguage(subject, language, message) {
  if (MONOLINGUAL_SUBJECTS.includes(subject)) return 'bm';
  if (ENGLISH_SUBJECTS.includes(subject)) return 'en';
  if (detectEnglishRequest(message)) return 'en';
  return language || 'bm';
}

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// Learnova Pedagogy Engine - initialised once, shared across all requests
const pedagogyEngine = new PedagogyEngine(supabase);

// ── Conversation logger (fire-and-forget, never blocks response) ─────────────
async function logConversation({
  studentId, sessionId, subject, topic, form, role, message,
  messageType = 'text', aiModel = null, responseSource = null,
  tokensUsed = null, responseTimeMs = null, pedagogyType = null,
  strategyUsed = null, failureTier = 0
}) {
  try {
    let flaggedForReview = false;
    let flagReason = null;

    if (role === 'assistant' && message.length < 50) {
      flaggedForReview = true;
      flagReason = 'response_too_short';
    }

    const englishPhrases = /\b(and once|before we|let me|I will|you can|make sense|great choice)\b/i;
    if (role === 'assistant' && englishPhrases.test(message)) {
      flaggedForReview = true;
      flagReason = 'language_mixing_detected';
    }

    if (failureTier >= 3) {
      flaggedForReview = true;
      flagReason = `high_failure_tier_${failureTier}`;
    }

    await supabase.from('conversation_logs').insert({
      student_id: studentId || null,
      session_id: sessionId || 'unknown',
      subject: subject || null,
      topic: topic || null,
      form: form ? `Form ${form}` : null,
      role,
      message: (message || '').substring(0, 5000),
      message_type: messageType,
      ai_model_used: aiModel,
      response_source: responseSource,
      tokens_used: tokensUsed,
      response_time_ms: responseTimeMs,
      pedagogy_type: pedagogyType,
      strategy_used: strategyUsed,
      failure_tier: failureTier,
      flagged_for_review: flaggedForReview,
      flag_reason: flagReason
    });
  } catch (err) {
    console.error('[ConvLog] Failed to log:', err.message);
  }
}

// ── Session end signals ───────────────────────────────────────────────────────
const END_SIGNALS = ['done', 'habis', "that's all", 'stop', 'sudah', 'cukup', 'bye', 'terima kasih', 'thank you', 'ok dah', 'dah habis', 'nak berhenti', 'selesai'];

const DEEPSEEK_MAX_PER_SESSION = 5;

async function getDeepSeekCount(session_id) {
  try {
    const { count } = await supabase
      .from('session_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session_id)
      .eq('strategy_used', 'deepseek_enrichment');
    return count || 0;
  } catch (_) { return 0; }
}

// DeepSeek for general enrichment and calculation help
async function callDeepSeekEnrichment(subject, topic, studentFormLevel, history, userMsg) {
  try {
    const systemPrompt = `Kamu adalah pembantu AI untuk platform tuisyen Malaysia bernama Learnova.
Pelajar sedang belajar ${subject} Form ${studentFormLevel || 4}. Topik semasa: ${topic || subject}.
Jawab dalam Bahasa Malaysia sepenuhnya. Jawapan mestilah:
- Ringkas (maksimum 5 ayat untuk enrichment, langkah demi langkah untuk kalkulasi)
- Berkaitan dengan silibus SPM Malaysia
- Mesra dan mudah difahami
- JANGAN ajar konsep baru — hanya jawab soalan yang ditanya
- Untuk kalkulasi: tunjukkan setiap langkah dengan jelas
Jangan mendedahkan bahawa kamu adalah model AI lain. Kamu adalah Learnova AI Tutor.`;

    const messages = [
      ...((history || []).slice(-4).map(m => ({ role: m.role, content: m.content }))),
      { role: 'user', content: userMsg }
    ];

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 400, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
    });
    const data = await response.json();
    if (!response.ok) { console.error('[DeepSeek] Error:', data); return null; }
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[DeepSeek] Enrichment error:', e.message);
    return null;
  }
}

// DeepSeek client (phase 3 - cheaper than Claude for standard responses)
async function callDeepSeek(system, userMessage, maxTokens = 300) {
  // Temporarily disabled - no credits
  return null;
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage }
      ]
    })
  });
  const data = await response.json();
  console.log('DeepSeek response status:', response.status);
  if (!response.ok) {
    console.error('DeepSeek error:', JSON.stringify(data));
    return null;
  }
  const result = data.choices?.[0]?.message?.content || null;
  console.log('DeepSeek result:', result ? result.substring(0, 50) : 'NULL');
  return result;
}

// â"€â"€ HARDCODED PEDAGOGY RULES â"€â"€ applied to every system prompt, always â"€â"€â"€â"€â"€â"€
const PEDAGOGY_RULES = `
TEACHING STYLE - THESE RULES ARE ABSOLUTE AND CANNOT BE OVERRIDDEN:
- If the student asks a simple factual question (e.g. "what is 2+2", "what is the capital of Malaysia"), answer it directly in ONE sentence, then redirect back to the lesson topic with a question.
- NEVER introduce yourself. NEVER say "I am ready to help". Just respond to what the student said.
- Maximum 2-3 short sentences per reply. Never more. Never.
- Always end with exactly ONE question to the student. One question only.
- NEVER lecture or dump information. Guide through questions and discovery.
- NEVER use bullet points, numbered lists, headers, bold text, or markdown.
- NEVER use emojis or special symbols of any kind.
- Plain conversational sentences only - write exactly as a tutor speaks out loud.
- If a student is confused, ask a simpler question, do not re-explain everything.
- Celebrate correct answers warmly in one sentence, then move on with a question.
- Check understanding frequently - do not proceed until student confirms they get it.
- Be warm, encouraging, and patient like a favourite teacher sitting next to the student.
`.trim();

// â"€â"€â"€ DB helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function getLesson(subject, topic) {
  const { data } = await supabase
    .from('lessons').select('*')
    .eq('subject', subject)
    .ilike('topic', '%' + topic + '%')
    .eq('status', 'published')
    .maybeSingle();
  return data;
}

// â"€â"€â"€ Adaptive Pedagogy Engine â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// 4-layer system: Pedagogy + Personality + Memory Anchors + Misconceptions

async function loadPedagogyIntelligence(subject, topic, studentFormLevel) {
  try {
    // PRIORITY 1: concept_chunks (processed textbook knowledge)
    let chunksQuery = supabase
      .from('concept_chunks')
      .select('concept_title, concept_explanation, worked_example, common_mistakes, check_in_question, check_in_options, check_in_answer, check_in_explanation, difficulty_level, keywords')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .order('difficulty_level', { ascending: true })
      .limit(5);

    if (studentFormLevel) {
      const formString = typeof studentFormLevel === 'number'
        ? `Form ${studentFormLevel}`
        : studentFormLevel;
      chunksQuery = chunksQuery.eq('form', formString);
    }

    const { data: chunks } = await chunksQuery;

    if (chunks && chunks.length > 0) {
      console.log(`[KnowledgeBase] concept_chunks hit: ${chunks.length} chunks for ${subject}/${topic}`);
      return {
        pedagogy_json: { source: 'concept_chunks', concepts: chunks },
        pedagogy_type: ['concept_chunks'],
        visual_required: false
      };
    }

    // PRIORITY 2: pedagogy_samples (real tutor transcripts)
    const { data: sample } = await supabase
      .from('pedagogy_samples')
      .select('teaching_sequence, tone_examples, pacing_notes, subject_specific_tips')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .maybeSingle();

    if (sample) {
      console.log(`[KnowledgeBase] pedagogy_samples hit for ${subject}/${topic}`);
      return {
        pedagogy_json: { source: 'pedagogy_sample', ...sample },
        pedagogy_type: ['pedagogy_sample'],
        visual_required: false
      };
    }

    // PRIORITY 3: pedagogy_library (existing structured pedagogy)
    const { data: lib } = await supabase
      .from('pedagogy_library')
      .select('pedagogy_json, pedagogy_type, visual_required')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .maybeSingle();
    if (lib?.pedagogy_json) return lib;

    // PRIORITY 4: lessons.pedagogy (legacy fallback)
    const { data: lesson } = await supabase
      .from('lessons')
      .select('pedagogy')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .eq('status', 'published')
      .not('pedagogy', 'is', null)
      .maybeSingle();
    if (lesson?.pedagogy) return { pedagogy_json: lesson.pedagogy, pedagogy_type: [], visual_required: false };

  } catch (_) {}
  return null;
}

async function loadPedagogySample(subject, topic) {
  try {
    const { data } = await supabase
      .from('pedagogy_samples')
      .select('teaching_sequence, tone_examples, pacing_notes, subject_specific_tips')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

async function loadMemoryAnchors(subject, topic) {
  try {
    const { data } = await supabase
      .from('memory_anchor_library')
      .select('anchor, purpose, mnemonic_type, student_variants')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%');
    return data || [];
  } catch (_) { return []; }
}

async function loadMisconceptions(subject, topic) {
  try {
    const { data } = await supabase
      .from('misconception_library')
      .select('mistake, correction, severity')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .order('severity', { ascending: false }); // high severity first
    return data || [];
  } catch (_) { return []; }
}

async function loadPersonalityProfile() {
  try {
    const { data } = await supabase
      .from('tutor_personality_profiles')
      .select('*')
      .eq('is_default', true)
      .maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

// Maps pedagogy_type to specific teaching strategy instructions
function selectTeachingStrategy(pedagogyTypes) {
  const strategies = {
    'visual-interactive':
      'Reference visual patterns and spatial layouts. Ask student to visualize or describe before calculating. Use language like "picture this", "imagine the circle", "what shape do you see?"',
    'spatial-procedural':
      'Focus on step-by-step spatial operations. Use grid metaphors. Reference positions explicitly (row, column, element). Walk through every calculation cell by cell.',
    'analogy-driven':
      'Always introduce with a real-world analogy BEFORE the formula. The analogy must come first. Then connect it to the math. Never open with abstract definitions.',
    'procedural-exam':
      'Teach using SPM marking scheme logic. Frame every step as a mark: "this step earns 1 mark." Emphasize what the examiner expects. Correct format before correct answer.',
    'structured-writing':
      'Guide paragraph by paragraph. Never skip elaboration. Require the student to expand every isi before moving to the next. Use PEHK structure explicitly.',
    'conversational-language':
      'Use roleplay and social scenarios. Focus on tone, politeness, and social context. Ask student to consider the relationship between speaker and listener before writing.',
    'drill-mastery':
      'Use rapid short exchanges. After explanation, immediately ask the student to apply. Repeat the core formula or rule until student can state it without prompting.',
    'guided-discovery':
      'Never give the answer directly. Use Socratic questioning to lead student to discover the concept themselves. Respond to every student message with a question that nudges them one step closer.',
  };

  if (!pedagogyTypes || pedagogyTypes.length === 0) return '';
  const selected = pedagogyTypes.map(t => strategies[t]).filter(Boolean);
  if (selected.length === 0) return '';
  return '\n\nTEACHING STRATEGY (apply this style throughout):\n' + selected.join('\n');
}

// â"€â"€â"€ Visual Generation â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Runs in parallel with the main concept reply when visual_required = true.
// Uses Claude Haiku (fast, cheap) to generate a structured visual spec.

const VISUAL_TYPES = {
  // topic keyword â†’ preferred visual type
  'trigonometry': 'desmos', 'sine': 'desmos', 'cosine': 'desmos', 'tangent': 'desmos',
  'graph': 'desmos', 'function': 'desmos', 'curve': 'desmos', 'linear': 'desmos',
  'quadratic': 'desmos', 'exponential': 'desmos', 'logarithm': 'desmos',
  'matrix': 'math_working', 'matrices': 'math_working', 'simultaneous': 'math_working',
  'variation': 'math_working', 'inverse': 'math_working', 'proof': 'math_working',
  'probability': 'chart', 'distribution': 'chart', 'statistics': 'chart', 'data': 'chart',
};

function guessVisualType(topic) {
  const t = topic.toLowerCase();
  for (const [kw, type] of Object.entries(VISUAL_TYPES)) {
    if (t.includes(kw)) return type;
  }
  return 'math_working'; // safe default for math subjects
}

async function generateVisual(subject, topic, reply, segment, pedagogyResult) {
  // Only generate visuals for topics marked visual_required or Math/Science subjects
  const visualRequired = pedagogyResult?.visual_required ||
    ['Mathematics', 'Add Maths', 'Physics', 'Chemistry'].includes(subject);
  if (!visualRequired) return null;

  const preferredType = guessVisualType(topic);

  const prompt = `You generate visual learning aids for Malaysian SPM students (Flutter web app).

Subject: ${subject}
Topic: ${topic}
Teaching phase: ${segment + 1}
Tutor just said: "${reply.substring(0, 200)}"

Generate a visual that DIRECTLY supports what the tutor said. Choose the best type:
- "math_working" â†’ step-by-step algebraic or numeric calculations with LaTeX
- "desmos" â†’ function graphs, curves, geometric plots (DO NOT use for pure algebra)
- "chart" â†’ bar/line charts for statistical data
- "none" â†’ tutor asked a conversational question only, no calculation shown

IMPORTANT LaTeX rules: use double backslash in JSON strings (\\\\sin not \\sin). Keep LaTeX simple and valid.

Respond ONLY with JSON, no markdown:
{
  "type": "math_working|desmos|chart|none",
  "math_working": {
    "title": "short title",
    "steps": [{"label": "what this step shows", "latex": "LaTeX string"}]
  },
  "desmos": {
    "title": "short title",
    "expressions": ["LaTeX expression â€" e.g. y=\\\\sin(x)"],
    "bounds": {"left": -360, "right": 360, "bottom": -2, "top": 2},
    "degreeMode": true
  },
  "chart": {
    "title": "short title",
    "type": "line",
    "xLabel": "x-axis label",
    "yLabel": "y-axis label",
    "series": [{"name": "label", "color": "#6C63FF", "points": [[0,0],[1,1]]}]
  }
}`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = r.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    if (!parsed.type || parsed.type === 'none') return null;
    // Clean up nulls â€" remove fields that don't match the type
    if (parsed.type !== 'math_working') delete parsed.math_working;
    if (parsed.type !== 'desmos') delete parsed.desmos;
    if (parsed.type !== 'chart') delete parsed.chart;
    return parsed;
  } catch (e) {
    console.error('Visual gen error:', e.message);
    return null;
  }
}

function _legacyBuildPrompt({ role, subject, topic, standardContext,
  pedagogy, anchors, misconceptions, personality, teachingStrategy, langSuffix }) {

  const pj = pedagogy?.pedagogy_json || null;
  const lines = [];

  // â"€â"€ Layer 1: Role + Base Rules (always present) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  lines.push('You are ' + role + '.');
  if (standardContext) lines.push(standardContext);
  lines.push('\n' + PEDAGOGY_RULES);

  // â"€â"€ Layer 2: Personality (tone, pace, interaction style) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (personality?.rules?.prompt_style) {
    lines.push('\nPERSONALITY â€" ' + (personality.display_name || personality.name).toUpperCase() + ':');
    lines.push(personality.rules.prompt_style);
  }

  // â"€â"€ Layer 3: Teaching Strategy (based on pedagogy_type) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (teachingStrategy) lines.push(teachingStrategy);

  // â"€â"€ Layer 4: Topic-Specific Pedagogy Intelligence â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (pj) {
    lines.push('\n\nTEACHING PROTOCOL â€" ' + topic.toUpperCase() + ' (from real SPM teacher):');

    if (pj.opening_hook) lines.push('OPENING HOOK: ' + pj.opening_hook);

    if (pj.lesson_flow && pj.lesson_flow.length) {
      lines.push('LESSON FLOW: ' + pj.lesson_flow.join(' â†’ '));
    }

    if (pj.teaching_phases && pj.teaching_phases.length) {
      lines.push('CHECK-IN QUESTIONS TO USE:');
      pj.teaching_phases.forEach(function(p) {
        lines.push('  Phase ' + p.phase + ' (' + p.name + '): "' + p.check_in + '"');
      });
    }

    if (pj.worked_example) {
      const w = pj.worked_example;
      lines.push('WORKED EXAMPLE APPROACH: ' + w.problem);
      (w.steps || w.solution_steps || []).forEach(function(s, i) {
        lines.push('  Step ' + (i + 1) + ': ' + s);
      });
    }

    if (pj.answering_technique) {
      lines.push('SPM ANSWER FORMAT: ' + pj.answering_technique.format);
      if (pj.answering_technique.example) lines.push('  Example: ' + pj.answering_technique.example);
    }

    if (pj.pehk_method) {
      const p = pj.pehk_method;
      lines.push('PEHK: P=' + p.P + ' | E=' + p.E + ' | H=' + p.H + ' | K=' + p.K);
    }

    if (pj.summary_prompt) lines.push('END OF LESSON: ' + pj.summary_prompt);
  }

  // â"€â"€ Layer 5: Memory Anchors â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (anchors && anchors.length > 0) {
    lines.push('\nMEMORY ANCHORS â€" USE THESE in your explanations:');
    anchors.forEach(function(a) {
      const variants = a.student_variants && a.student_variants.length
        ? ' (student versions: ' + a.student_variants.join(', ') + ')' : '';
      lines.push('  "' + a.anchor + '" â†’ ' + a.purpose + variants);
    });
  }

  // â"€â"€ Layer 6: Misconception Warnings â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (misconceptions && misconceptions.length > 0) {
    lines.push('\nCOMMON MISTAKES â€" watch for these and correct proactively:');
    misconceptions.forEach(function(m) {
      lines.push('  [' + (m.severity || 'medium') + '] "' + m.mistake + '" â†’ ' + m.correction);
    });
  }

  // â"€â"€ Language â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (langSuffix) lines.push('\n' + langSuffix);

  return lines.join('\n');
}


// ── DEFAULT TEACHING SEQUENCE (used when no specific pedagogy exists) ──────────
const DEFAULT_TEACHING_SEQUENCE = [
  { phase: 1, concept: 'Real-world connection and prior knowledge check', teacher_says: 'Start with one warm sentence connecting this topic to real life, then ask what they already know.', check_in_question: 'Before we start, have you come across this topic before in class?' },
  { phase: 2, concept: 'Core concept introduction', teacher_says: 'Introduce the single most important idea in 2 sentences. No formulas yet.', check_in_question: 'Does that basic idea make sense to you so far?' },
  { phase: 3, concept: 'Definition and notation', teacher_says: 'Now introduce the formal definition and any symbols or notation used.', check_in_question: 'Can you tell me in your own words what this means?' },
  { phase: 4, concept: 'Worked example walkthrough', teacher_says: 'Walk through one worked example step by step. Show one step, then check understanding.', check_in_question: 'Try the next step yourself — what do you think comes next?' },
  { phase: 5, concept: 'Common mistakes and exam technique', teacher_says: 'Warn about the most common mistake students make. Explain how to avoid it.', check_in_question: 'Do you see why students often get confused at this point?' },
];

function getPhaseInstruction(pedagogyResult, segment) {
  const pj = pedagogyResult?.pedagogy_json;
  const sequence = (pj?.teaching_sequence && pj.teaching_sequence.length) ? pj.teaching_sequence : DEFAULT_TEACHING_SEQUENCE;
  const phaseIdx = Math.min(segment, sequence.length - 1);
  const phase = sequence[phaseIdx];
  if (!phase) return null;
  const lines = [];
  if (phaseIdx === 0 && pj?.opening_hook) lines.push('OPENING HOOK: ' + pj.opening_hook);
  lines.push('CURRENT PHASE ' + (phase.phase || phaseIdx + 1) + ' of ' + sequence.length + ': ' + (phase.concept || ''));
  if (phase.teacher_says) lines.push('HOW TO TEACH: ' + phase.teacher_says);
  if (phase.explanation) lines.push('CONTENT: ' + phase.explanation.substring(0, 200));
  lines.push('END WITH EXACTLY THIS QUESTION: "' + (phase.check_in_question || 'Does that make sense so far?') + '"');
  lines.push('RULES: Teach ONLY this phase concept. Max 3 sentences. End with exact question above. Do NOT move to next concept.');
  return lines.join('\n');
}
async function getPracticeQuestions(subject, topic, limit) {
  if (!limit) limit = 3;
  const { data } = await supabase
    .from('quiz_questions')
    .select('id, question, options, correct_answer, explanation, quizzes!inner(subject, topic)')
    .eq('quizzes.subject', subject)
    .ilike('quizzes.topic', '%' + topic + '%')
    .not('correct_answer', 'is', null)
    .limit(limit);
  return data || [];
}

async function getAllTopicsForSubject(subject) {
  const { data } = await supabase
    .from('lessons')
    .select('id, topic, chapter_number')
    .eq('subject', subject)
    .eq('status', 'published')
    .order('chapter_number', { ascending: true });
  return data || [];
}

async function getLearningStandards(subject, topic) {
  const { data: direct } = await supabase
    .from('learning_standards')
    .select('code, description, subtopic_num')
    .eq('subject', subject)
    .ilike('topic', '%' + topic + '%')
    .order('code', { ascending: true });
  if (direct && direct.length > 0) return direct;

  const words = topic.split(/\s+/).filter(w => w.length >= 4);
  const stopWords = new Set(['with','that','this','from','into','also','some','have','been','will','which']);
  const keywords = words.filter(w => !stopWords.has(w.toLowerCase()));

  for (let i = 0; i < keywords.length - 1; i++) {
    const pair = keywords[i] + ' ' + keywords[i + 1];
    const { data: byPair } = await supabase
      .from('learning_standards')
      .select('code, description, subtopic_num')
      .eq('subject', subject)
      .ilike('topic', '%' + pair + '%')
      .order('code', { ascending: true });
    if (byPair && byPair.length > 0) return byPair;
  }

  const longest = keywords.sort((a, b) => b.length - a.length)[0];
  if (longest) {
    const { data: byWord } = await supabase
      .from('learning_standards')
      .select('code, description, subtopic_num')
      .eq('subject', subject)
      .ilike('topic', '%' + longest + '%')
      .order('code', { ascending: true });
    if (byWord && byWord.length > 0) return byWord;
  }

  return [];
}

function getStandardForSegment(standards, segment) {
  if (!standards || standards.length === 0) return null;
  const idx = Math.min(segment, standards.length - 1);
  return standards[idx];
}

// â"€â"€â"€ Tutor Cache Layer â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Zero-cost responses for predictable student intents (~70% of all messages).
// Rule-based classifier â€" no API call needed. Cache hit = no Claude cost.

const INTENT_PATTERNS = {
  affirmative: [
    /^(yes|yep|yeah|ok|okay|sure|got it|i see|i get it|understood|makes sense|faham|paham|ok ok|boleh|ohhh|ahh|ah ok|i understand|that makes sense|i got it|yes i understand|yes i get it|correct|right|true|yup)\b/i,
    /^(ok(ay)?[,!.]?\s*(continue|lanjut|next|proceed|go on|carry on)?|yes[,!.]?\s*(continue|please|go ahead)?)\s*$/i,
    /continue please|yes please|go ahead|lanjut/i,
  ],
  confused: [
    /\b(confused|confuse|don't understand|dont understand|not sure|blur|blur blur|tak faham|tak tahu|i don'?t get it|what do you mean|huh\??|what\??|lost|lost me|lost you|not following)\b/i,
    /^(huh|what|blur|eh|uh)\??\.?$/i,
    /can you (explain|re-?explain|repeat|say that again|try again|simplify)/i,
  ],
  continue: [
    /^(continue|next|proceed|move on|go on|carry on|lanjut|seterusnya|next please|let'?s continue|ok next)\s*[!.]?$/i,
    /^(continue please|continue!|next!|go on!)\s*$/i,
  ],
  wants_example: [
    /\b(example|contoh|show me|for instance|like what|give me an example|another example|can you show)\b/i,
    /example please|give example/i,
  ],
};

/**
 * Classify student message into a cache intent. Returns null for freeform.
 * Zero API cost â€" pure string matching.
 */
function classifyStudentIntent(message) {
  if (!message || message === 'start') return null;
  const msg = message.trim();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some(p => p.test(msg))) return intent;
  }
  return null; // freeform â€" needs Claude
}

/**
 * Look up a cached response for this subject/topic/phase/intent/language.
 * Returns the cache row or null.
 */
async function lookupCache(subject, topic, phase, intent, language) {
  try {
    const { data } = await supabase
      .from('tutor_cache')
      .select('id, reply, visual, suggested_responses, is_check_in')
      .eq('subject', subject)
      .ilike('topic', '%' + topic + '%')
      .eq('phase', phase)
      .eq('intent', intent)
      .eq('language', language)
      .maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

/**
 * Save a Claude response to cache for future reuse.
 * Silently fails â€" never blocks the response.
 */
async function saveToCache(subject, topic, phase, intent, language, reply, visual, suggestedResponses, isCheckIn) {
  try {
    await supabase.from('tutor_cache').upsert({
      subject,
      topic,
      phase,
      intent,
      language,
      reply,
      visual: visual || null,
      suggested_responses: suggestedResponses || [],
      is_check_in: isCheckIn || false,
      hit_count: 0,
    }, { onConflict: 'subject,topic,phase,intent,language', ignoreDuplicates: false });
  } catch (e) {
    console.error('Cache save error (non-fatal):', e.message);
  }
}

/**
 * Increment hit_count on a cache row (fire-and-forget).
 */
function bumpCacheHit(cacheId) {
  supabase.rpc('increment_cache_hit', { cache_id: cacheId }).then(() => {}).catch(() => {});
}

async function detectTopicSwitch(message, currentTopic, subject) {
  const msgLower = message.toLowerCase();
  const switchKeywords = [
    'want to learn', 'want to study', 'can we do', 'can we learn', 'can we study',
    'today we did', 'teacher taught', 'school taught', 'we learned', 'we studied',
    'switch to', 'change to', "let's do", 'lets do', 'i need help with',
    'can you teach me', 'teach me about'
  ];
  const hasSwitchIntent = switchKeywords.some(function(kw) { return msgLower.includes(kw); });
  if (!hasSwitchIntent) return null;

  const topics = await getAllTopicsForSubject(subject);
  if (!topics.length) return null;

  let bestMatch = null;
  let bestScore = 0;
  topics.forEach(function(t) {
    const topicWords = t.topic.toLowerCase().split(' ');
    const matchCount = topicWords.filter(function(w) { return w.length > 3 && msgLower.includes(w); }).length;
    if (matchCount > bestScore) { bestScore = matchCount; bestMatch = t; }
  });

  if (bestMatch && bestScore > 0 && bestMatch.topic !== currentTopic) return bestMatch;
  return null;
}

// â"€â"€â"€ Main session handler â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

router.post('/session', async (req, res) => {
  try {
    const {
      subject = 'Mathematics',
      topic,
      message = 'start',
      history = [],
      phase = 'intro',
      segment = 0,
      activeQuestion = null,
      language = 'bm',
      studentConfused = false,
      studentFormLevel = 4,
      student_id = null,
      session_id = null,
      pre_read = false,
    } = req.body;

    const effectiveSessionId = session_id || (student_id ? `${student_id}_${Date.now()}` : `anon_${Date.now()}`);

    const effectiveLanguage = getEffectiveLanguage(subject, language, message);
    // No topic = general question, answer directly with DeepSeek
    if (!topic) {
      try {
        const generalSystem = `Answer the student's question directly and concisely. Do NOT introduce yourself. Do NOT say you are a tutor. Just answer the question in 1-2 sentences. If it is math, give the answer and brief explanation.`;
        let answer = null;
        try {
          answer = await callDeepSeek(generalSystem, message, 200);
        } catch(e) { answer = null; }
        // If DeepSeek failed or returned null, use Claude
        if (!answer || answer.trim().length < 3) {
          const r = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: 100,
            messages: [{ 
              role: 'user', 
              content: 'Answer this question in 1-2 sentences only, no introduction: ' + message 
            }]
          });
          answer = r.content[0].text;
        }
        return res.json({ answer, reply: answer, source: 'deepseek', related_questions: [] });
      } catch(e) {
        return res.json({ answer: 'Sorry, I had trouble with that. Please try again.', reply: '', source: 'error', related_questions: [] });
      }
    }

    // â"€â"€ Topic switch detection â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (message !== 'start' && phase !== 'quiz_answer') {
      const switchTarget = await detectTopicSwitch(message, topic, subject);
      if (switchTarget) {
        return res.json({
          reply: 'Kamu nak belajar ' + switchTarget.topic + ' - bagus tu! Jom kita tukar ke topik tu sekarang?',
          phase: phase, segment: segment, isCheckIn: false, activeQuestion: null,
          topicSwitchSuggested: true, suggestedTopic: switchTarget.topic, suggestedTopicId: switchTarget.id,
          suggestedResponses: ['Ya, tukar ke ' + switchTarget.topic + '!', 'Tak, teruskan topik ni'],
          standardCode: null, standardDesc: null, standardsProgress: null
        });
      }
    }

    // Log student message (fire-and-forget)
    if (message !== 'start') {
      logConversation({
        studentId: student_id, sessionId: effectiveSessionId,
        subject, topic, form: studentFormLevel,
        role: 'student', message, messageType: 'text',
      });
    }

    // Load content + all pedagogy intelligence layers in parallel
    const [lesson, practiceQuestions, standards, pedagogyResult, anchors, misconceptions, personality, pedagogySample] =
      await Promise.all([
        getLesson(subject, topic),
        getPracticeQuestions(subject, topic),
        getLearningStandards(subject, topic),
        loadPedagogyIntelligence(subject, topic, studentFormLevel),
        loadMemoryAnchors(subject, topic),
        loadMisconceptions(subject, topic),
        loadPersonalityProfile(),
        loadPedagogySample(subject, topic),
      ]);

    const currentStandard = getStandardForSegment(standards, segment);
    const totalStandards = standards.length;
    const teachingStrategy = selectTeachingStrategy(pedagogyResult?.pedagogy_type || []);

    const standardsProgress = currentStandard
      ? 'Standard ' + currentStandard.code + ' (' + (segment + 1) + ' of ' + totalStandards + ')'
      : null;

    // â"€â"€ INTRO: one conversational question, no content dump â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (message === 'start' || phase === 'intro') {
      const pj = pedagogyResult?.pedagogy_json;
      const introHook = pj?.opening_hook
        ? ' Your opening strategy: ' + pj.opening_hook
        : ' Greet them warmly, then ask ONE question about what they already know.';
      const introSystem = buildMasterSystemPrompt({
        role: 'a warm, friendly SPM ' + subject + ' tutor',
        subject, topic, standardContext: '',
        pedagogy: pedagogyResult, anchors, misconceptions, personality,
        teachingStrategy, language: effectiveLanguage,
        pedagogySample,
      });
      // Try DeepSeek first for intro (cheaper)
      const introUserMsg = pre_read
        ? 'Pelajar baru sahaja selesai membaca pengenalan topik "' + topic + '". Jangan bagi pengenalan lagi. Tanya dengan mesra apa yang mereka faham dari bacaan tadi. Satu soalan sahaja, satu ayat sahaja.'
        : 'The student just chose "' + topic + '".' + introHook + ' No lists, no overviews, no content yet. ONE warm sentence + ONE question only.';
      let introReply = null;
      try {
        introReply = await callDeepSeek(introSystem, introUserMsg, 120);
      } catch (e) { console.log('DeepSeek intro fallback:', e.message); }
      if (!introReply || introReply.trim().length < 10) {
        const r = await anthropic.messages.create({
          model: 'claude-sonnet-4-5', max_tokens: 120,
          system: introSystem,
          messages: [{ role: 'user', content: introUserMsg }]
        });
        introReply = r.content[0].text;
      }
      const r = { content: [{ text: introReply }] };
      return res.json({
        reply: r.content[0].text.trim(),
        phase: 'concept', segment: 0, isCheckIn: false, activeQuestion: null,
        topicSwitchSuggested: false,
        standardCode: standards.length > 0 ? standards[0].code : null,
        standardDesc: standards.length > 0 ? standards[0].description : null,
        standardsProgress: null,
        suggestedResponses: pre_read
          ? ['Saya faham asasnya', 'Ada bahagian yang keliru', 'Boleh terangkan semula?']
          : ['Baru nak belajar, tak pernah dengar!', 'Saya tahu sikit-sikit', 'Saya dah belajar ni sebelum ni']
      });
    }

    // â"€â"€ QUIZ ANSWER â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (phase === 'quiz_answer' && activeQuestion) {
      const q = activeQuestion;
      const studentAns = message.trim().toUpperCase().charAt(0);
      const correct = studentAns === (q.correct_answer || '').toUpperCase();
      const nextStandard = getStandardForSegment(standards, segment + 1);

      if (correct) {
        const nextMsg = nextStandard
          ? ' Next up is Standard ' + nextStandard.code + ': ' + nextStandard.description.substring(0, 60) + '...'
          : " You have covered all the standards for this topic!";
        return res.json({
          reply: 'Betul! Syabas! ' + (q.explanation || 'Kerja yang bagus!') + nextMsg,
          phase: 'concept', segment: segment + 1, isCheckIn: false, activeQuestion: null,
          topicSwitchSuggested: false,
          standardCode: nextStandard ? nextStandard.code : null,
          standardDesc: nextStandard ? nextStandard.description : null,
          standardsProgress: nextStandard
            ? 'Standard ' + nextStandard.code + ' (' + (segment + 2) + ' daripada ' + totalStandards + ')'
            : 'Topik Selesai!',
          suggestedResponses: ['Teruskan!', 'Saya ada soalan...', 'Bagi satu soalan lagi!']
        });
      }

      return res.json({
        reply: 'Belum tepat — jawapan yang betul ialah ' + q.correct_answer + '. ' + (q.explanation || 'Ulang kaji konsep ni ya.') + ' Jom kita teruskan?',
        phase: 'concept', segment: segment + 1, isCheckIn: false, activeQuestion: null,
        topicSwitchSuggested: false,
        standardCode: currentStandard ? currentStandard.code : null,
        standardDesc: currentStandard ? currentStandard.description : null,
        standardsProgress: standardsProgress,
        suggestedResponses: ['Faham, teruskan', 'Terangkan kenapa please', 'Bagi soalan lain']
      });
    }

    // â"€â"€ END SIGNAL / SESSION QUIZ TRIGGER â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const msgLower = message.toLowerCase();
    const wantsToEnd = message !== 'start' && END_SIGNALS.some(s => msgLower.includes(s));

    if (wantsToEnd && topic) {
      // Check session duration from session_events
      let sessionMinutes = 0;
      try {
        const { data: firstEvt } = await supabase
          .from('session_events')
          .select('created_at')
          .eq('session_id', req.body.session_id || '')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstEvt) sessionMinutes = (Date.now() - new Date(firstEvt.created_at).getTime()) / 60000;
      } catch (_) {}

      return res.json({
        reply: 'Okay, kita dah belajar banyak benda hari ni! Jom kita buat kuiz ringkas — 5 soalan je untuk check faham kamu. Ini bukan peperiksaan, just nak tengok mana yang dah faham dan mana yang perlu ulang kaji lagi. Boleh start?',
        phase: 'end_of_session_quiz',
        segment: segment,
        isCheckIn: false,
        activeQuestion: null,
        topicSwitchSuggested: false,
        sessionMinutes: Math.round(sessionMinutes),
        standardCode: null, standardDesc: null, standardsProgress: null,
        suggestedResponses: ['Ya, jom buat kuiz!', 'Skip, dah habis la'],
      });
    }

    // â"€â"€ PRACTICE REQUEST â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const wantsQuestion = msgLower.includes('practice') || msgLower.includes('give me a question') ||
      msgLower.includes('quiz') || msgLower.includes('soalan') || msgLower.includes('test me') ||
      msgLower.includes('practice question');

    if (wantsQuestion) {
      if (practiceQuestions.length > 0) {
        const idx = Math.min(segment, practiceQuestions.length - 1);
        const q = practiceQuestions[idx];
        let opts = '';
        if (q.options && typeof q.options === 'object') {
          opts = Object.entries(q.options).map(function(e) { return e[0] + '. ' + e[1]; }).join('\n');
        }
        const standardTag = currentStandard ? '\n\nTesting: Standard ' + currentStandard.code : '';
        return res.json({
          reply: 'Soalan Latihan:\n\n' + q.question + '\n\n' + opts + '\n\nTaip A, B, C atau D — atau guna workspace!' + standardTag,
          phase: 'quiz_answer', segment: segment, isCheckIn: false, activeQuestion: q,
          topicSwitchSuggested: false,
          standardCode: currentStandard ? currentStandard.code : null,
          standardDesc: currentStandard ? currentStandard.description : null,
          standardsProgress: standardsProgress,
          suggestedResponses: ['A', 'B', 'C', 'D'], openWorkspace: true
        });
      }
      return res.json({
        reply: "Tiada soalan latihan lagi untuk topik ni — jom teruskan pelajaran!",
        phase: 'concept', segment: segment, isCheckIn: false, activeQuestion: null,
        topicSwitchSuggested: false, standardCode: null, standardDesc: null, standardsProgress: standardsProgress,
        suggestedResponses: ['Teruskan pelajaran', 'Saya ada soalan...']
      });
    }

    // â"€â"€ DEEPSEEK ENRICHMENT ROUTING â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Only for enrichment/calculation — core teaching always uses Claude
    if (!studentConfused) {
      const classification = ResponseClassifier.classify(message, null, 'free_chat');
      const isEnrichment = classification.type === ResponseClassifier.TYPES.GENERAL_ENRICHMENT ||
                           classification.type === ResponseClassifier.TYPES.CALCULATION_HELP;

      if (isEnrichment) {
        const sessionId = req.body.session_id || '';
        const dsCount = sessionId ? await getDeepSeekCount(sessionId) : DEEPSEEK_MAX_PER_SESSION;

        if (dsCount < DEEPSEEK_MAX_PER_SESSION) {
          console.log('[Router] DeepSeek route:', classification.type);
          const dsReply = await callDeepSeekEnrichment(subject, topic, studentFormLevel, history, message);

          if (dsReply && dsReply.trim().length > 10) {
            if (sessionId) {
              supabase.from('session_events').insert({
                session_id: sessionId, student_id: req.body.student_id || null,
                event_type: classification.type, strategy_used: 'deepseek_enrichment',
              }).then(() => {}).catch(() => {});
            }
            return res.json({
              reply: dsReply.trim(),
              source: 'enrichment',
              phase: 'concept', segment: segment, isCheckIn: false, activeQuestion: null,
              topicSwitchSuggested: false,
              standardCode: currentStandard ? currentStandard.code : null,
              standardDesc: currentStandard ? currentStandard.description : null,
              standardsProgress: standardsProgress,
              suggestedResponses: ['Terima kasih! Teruskan pelajaran', 'Satu soalan lagi...', 'Faham, jom terus!'],
            });
          }
          console.log('[Router] DeepSeek enrichment returned null, falling back to Claude');
        } else {
          console.log('[Router] DeepSeek limit reached for session, using Claude');
        }
      }
    }

    // â"€â"€ CONCEPT â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const standardContext = currentStandard
      ? '\nYou are teaching Standard ' + currentStandard.code + ': ' + currentStandard.description + '\nThis is standard ' + (segment + 1) + ' of ' + totalStandards + ' for this topic.'
      : '';

    // â"€â"€ Pick the right explanation strategy based on confusion state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    let system, userMsg;

    if (studentConfused) {
      // Confusion protocol â€" fresh angle, use a memory anchor or analogy
      system = buildMasterSystemPrompt({
        role: 'a patient SPM ' + subject + ' tutor. The student is confused about "' + topic + '"',
        subject, topic, standardContext,
        pedagogy: pedagogyResult, anchors, misconceptions, personality,
        teachingStrategy, language: effectiveLanguage,
        pedagogySample,
      }) + '\n\nCONFUSION PROTOCOL â€" FOLLOW EXACTLY:\n'
        + '1. Do NOT repeat the previous explanation.\n'
        + '2. Choose ONE fresh strategy: use a memory anchor from MEMORY ANCHORS above, try a real-world analogy, or break the concept into the single smallest possible step.\n'
        + '3. Extremely simple language â€" as if explaining to a 12-year-old.\n'
        + '4. Maximum 2 sentences, then ONE simple yes/no or either/or question.\n'
        + '5. Do not mention they were confused. Pivot naturally.';

      userMsg = 'Student is confused and said: "' + message + '"\n\n'
        + 'Use a completely fresh angle â€" try a memory anchor, analogy, or the smallest possible step from the TEACHING PROTOCOL. 2 sentences max, then one simple question.';
    } else {
      system = buildMasterSystemPrompt({
        role: 'a warm, friendly SPM ' + subject + ' tutor guiding a student through "' + topic + '"',
        subject, topic, standardContext,
        pedagogy: pedagogyResult, anchors, misconceptions, personality,
        teachingStrategy, language: effectiveLanguage,
        pedagogySample,
      }) + '\nCONTEXT: The student already sees a VISUAL ANIMATION. DO NOT re-describe the animation. Your role: ask the CHECK-IN QUESTIONS from the TEACHING PROTOCOL, celebrate correct answers, correct mistakes using MISCONCEPTION guidance above.';
      const phaseInstruction = getPhaseInstruction(pedagogyResult, segment);
      userMsg = phaseInstruction
        ? phaseInstruction + '\n\nStudent just said: ' + message + '\nDeliver your phase instruction now. Follow the rules strictly.'
        : (currentStandard
            ? 'Standard ' + currentStandard.code + ' (' + currentStandard.description + '). Student said: ' + message + '\n\nGuide using TEACHING PROTOCOL. 2-3 sentences max, end with one question.'
            : 'Student said: ' + message + '\n\nGuide using TEACHING PROTOCOL. 2-3 sentences max, end with one question.');


    }

    // â"€â"€ Cache check: try to serve from pre-stored responses first â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Only for predictable intents (affirmative/confused/continue/wants_example).
    // Freeform questions always go to Claude.
    const studentIntent = classifyStudentIntent(message);
    if (studentIntent && !studentConfused) {
      const cached = await lookupCache(subject, topic, segment, studentIntent, language);
      if (cached) {
        bumpCacheHit(cached.id);
        return res.json({
          reply: cached.reply,
          visual: cached.visual || null,
          phase: 'concept',
          segment: cached.is_check_in ? segment : segment + 1,
          isCheckIn: cached.is_check_in || false,
          activeQuestion: null,
          topicSwitchSuggested: false,
          standardCode: currentStandard ? currentStandard.code : null,
          standardDesc: currentStandard ? currentStandard.description : null,
          standardsProgress: standardsProgress,
          totalStandards: totalStandards,
          suggestedResponses: cached.suggested_responses?.length
            ? cached.suggested_responses
            : ['Teruskan please!', 'Saya ada soalan...', 'Bagi soalan latihan!'],
          fromCache: true,
        });
      }
    }

    // Sanitize history for Anthropic: must start with 'user', no consecutive same roles,
    // and remove trailing user message (current student input is sent separately as userMsg).
    let safeHistory = history.slice(-6);
    // Drop trailing user message â€" we send student input via userMsg below
    if (safeHistory.length > 0 && safeHistory[safeHistory.length - 1].role === 'user') {
      safeHistory = safeHistory.slice(0, -1);
    }
    // Drop leading assistant messages â€" Anthropic requires first message to be 'user'
    while (safeHistory.length > 0 && safeHistory[0].role !== 'user') {
      safeHistory.shift();
    }
    const msgs = safeHistory.concat([{ role: 'user', content: userMsg }]);

    // -- Simple calculation detector (free, instant)
    const simpleCalc = message.match(/^[\d\s\+\-\*\/\^\(\)\.]+[=\?]?\s*$/);
    const simpleQuestion = /^what\s+is\s+[\d\s\+\-\*\/x]+\??$/i.test(message.trim());
    if (simpleCalc || simpleQuestion) {
      try {
        const calcResult = eval(message.replace(/[^0-9\+\-\*\/\(\)\.\s]/g, '').trim());
        if (!isNaN(calcResult)) {
          const reply = `The answer is ${calcResult}. Now back to ${topic} - ${getPhaseInstruction(pedagogyResult, segment)?.split('END WITH')[1]?.replace('EXACTLY THIS QUESTION: "','')?.replace('"','') || 'shall we continue with our lesson?'}`;
          return res.json({ reply, phase, segment, isCheckIn: false, activeQuestion: null,
            suggestedResponses: ['Ya, teruskan!', 'Saya ada soalan'], source: 'hardcoded',
            standardCode: null, standardDesc: null, standardsProgress: null });
        }
      } catch(e) {}
    }

    // Run main reply + visual generation in PARALLEL
    // Phase 3: Try DeepSeek first (cheaper), fall back to Claude Sonnet
    const _replyStart = Date.now();
    const [replyText, visual] = await Promise.all([
      (async () => {
        try {
          const ds = await callDeepSeek(system, userMsg, 280);
          if (ds && ds.trim().length > 10) return ds.trim();
        } catch (e) { console.log('DeepSeek fallback to Claude:', e.message); }
        const r = await anthropic.messages.create({
          model: 'claude-sonnet-4-5', max_tokens: 280, system: system, messages: msgs
        });
        return r.content[0].text;
      })(),
      generateVisual(subject, topic, userMsg, segment, pedagogyResult),
    ]);
    const _replyMs = Date.now() - _replyStart;

    const reply = replyText
      .trim()
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u{2600}-\u{27BF}]/gu, '')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const rl = reply.toLowerCase();
    const isCheckIn = rl.includes('faham') || rl.includes('make sense') ||
      rl.includes('any questions') || rl.includes('understand') ||
      rl.includes('okay?') || rl.includes('ready') || rl.includes('shall we') ||
      rl.includes('boleh?') || rl.includes('jelas?') || rl.includes('ada soalan') ||
      rl.includes('dah clear') || rl.includes('masuk akal') || rl.includes('macam mana');

    const confusedResponses = ['Dah faham sikit sekarang!', 'Masih keliru sikit...', 'Boleh bagi contoh lain?'];
    const checkInResponses  = ['Ya, faham! Teruskan', 'Saya ada soalan...', 'Terangkan lagi sekali', 'Bagi soalan latihan!'];
    const normalResponses   = ['Teruskan please!', 'Saya ada soalan...', 'Masih keliru, terangkan cara lain', 'Bagi soalan latihan!'];

    const suggestedResponses = studentConfused ? confusedResponses : isCheckIn ? checkInResponses : normalResponses;

    // â"€â"€ Auto-save to cache for reuse (fire-and-forget, non-blocking) â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Only cache predictable-intent messages (not freeform open questions).
    if (studentIntent && !studentConfused) {
      saveToCache(subject, topic, segment, studentIntent, language,
        reply, visual, suggestedResponses, isCheckIn);
    }

    // Log AI response (fire-and-forget)
    logConversation({
      studentId: student_id, sessionId: effectiveSessionId,
      subject, topic, form: studentFormLevel,
      role: 'assistant', message: reply,
      aiModel: 'claude-sonnet-4-5',
      responseSource: pedagogyResult?.pedagogy_type?.includes('concept_chunks') ? 'concept_chunks' : 'claude',
      responseTimeMs: _replyMs,
      pedagogyType: pedagogyResult?.pedagogy_type?.[0] || null,
      strategyUsed: teachingStrategy || null,
      failureTier: studentConfused ? 1 : 0,
    });

    return res.json({
      reply: reply,
      visual: visual || null,
      phase: 'concept',
      segment: isCheckIn ? segment : segment + 1,
      isCheckIn: isCheckIn,
      activeQuestion: null,
      topicSwitchSuggested: false,
      standardCode: currentStandard ? currentStandard.code : null,
      standardDesc: currentStandard ? currentStandard.description : null,
      standardsProgress: standardsProgress,
      totalStandards: totalStandards,
      suggestedResponses: suggestedResponses,
    });

  } catch (err) {
    console.error('Tutor error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â"€â"€â"€ GET /api/tutor/topics â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

router.get('/topics', async (req, res) => {
  try {
    const { subject = 'Mathematics' } = req.query;
    const { data, error } = await supabase
      .from('lessons')
      .select('id, title, topic, form_level, learning_objectives')
      .eq('subject', subject)
      .eq('status', 'published')
      .order('chapter_number', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// â"€â"€â"€ GET /api/tutor/standards â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

router.get('/standards', async (req, res) => {
  try {
    const { subject, topic, student_id } = req.query;
    let query = supabase.from('learning_standards').select('*');
    if (subject) query = query.eq('subject', subject);
    if (topic)   query = query.ilike('topic', '%' + topic + '%');
    query = query.order('code', { ascending: true });
    const { data, error } = await query;
    if (error) throw error;

    let completed = [];
    if (student_id) {
      const { data: ws } = await supabase
        .from('workspace_submissions')
        .select('standard_code')
        .eq('student_id', student_id)
        .not('standard_code', 'is', null);
      completed = (ws || []).map(function(w) { return w.standard_code; });
    }

    const standards = (data || []).map(function(s) {
      return Object.assign({}, s, { completed: completed.includes(s.code) });
    });

    res.json({ standards: standards, total: standards.length, completed_count: completed.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;





