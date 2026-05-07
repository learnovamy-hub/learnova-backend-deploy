import express from 'express';
import { supabase } from '../config/database.js';

const router = express.Router();

/* ── Placeholder SVG builder ───────────────────────────────────────────────
   Called when no stored animation exists yet for a standard.
   Returns 3 basic animated steps built purely from the standard description.
   No Claude API call — just text layout in SVG.
─────────────────────────────────────────────────────────────────────────── */
function buildPlaceholderSteps(code, description) {
  // Break description into readable lines (~40 chars each)
  function wrapText(text, maxChars = 40) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > maxChars) {
        if (line) lines.push(line.trim());
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) lines.push(line.trim());
    return lines;
  }

  const descLines = wrapText(description, 42);

  // Extract keywords (words > 5 chars, not common words)
  const stopWords = new Set(['about','after','again','before','being','between','could','does',
    'during','first','given','have','having','into','other','should','since',
    'their','there','these','those','through','under','using','where','which',
    'while','with','within','without','would','value','values']);
  const keywords = description.split(/\W+/)
    .filter(w => w.length > 5 && !stopWords.has(w.toLowerCase()))
    .slice(0, 4);

  /* ── STEP 1: Standard intro ── */
  const step1Lines = descLines.map((line, i) =>
    `<text x="24" y="${100 + i * 22}" font-family="Arial" font-size="13" fill="${i === 0 ? '#E2E8F0' : '#94A3B8'}">${line}</text>`
  ).join('\n          ');

  const step1Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
  <rect width="480" height="300" fill="#0F1117"/>
  <rect x="0" y="0" width="480" height="54" fill="#1A1D27"/>
  <circle cx="20" cy="27" r="6" fill="#6366F1"/>
  <text x="34" y="32" font-family="Arial" font-size="13" font-weight="bold" fill="#6366F1">Standard ${code}</text>
  <line x1="0" y1="54" x2="480" y2="54" stroke="#2E3347" stroke-width="1"/>
  <text x="24" y="82" font-family="Arial" font-size="11" fill="#94A3B8">Learning objective:</text>
  ${step1Lines}
  <rect x="14" y="248" width="452" height="36" rx="8" fill="rgba(99,102,241,0.08)" stroke="rgba(99,102,241,0.3)" stroke-width="1"/>
  <text x="240" y="271" text-anchor="middle" font-family="Arial" font-size="12" fill="#6366F1">👀 Watch carefully — the key ideas are highlighted next</text>
</svg>`;

  /* ── STEP 2: Keywords highlighted ── */
  const kwBoxes = keywords.map((kw, i) => {
    const colors = ['#6366F1', '#10B981', '#F59E0B', '#EC4899'];
    const bgColors = ['rgba(99,102,241,0.15)', 'rgba(16,185,129,0.15)', 'rgba(245,158,11,0.15)', 'rgba(236,72,153,0.15)'];
    const c = colors[i % colors.length];
    const bg = bgColors[i % bgColors.length];
    const x = 24 + (i % 2) * 220;
    const y = 100 + Math.floor(i / 2) * 70;
    return `<rect x="${x}" y="${y}" width="190" height="52" rx="10" fill="${bg}" stroke="${c}" stroke-width="1.5"/>
    <text x="${x + 95}" y="${y + 24}" text-anchor="middle" font-family="Arial" font-size="10" fill="${c}">key concept</text>
    <text x="${x + 95}" y="${y + 42}" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="${c}">${kw}</text>`;
  }).join('\n  ');

  const step2Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
  <rect width="480" height="300" fill="#0F1117"/>
  <rect x="0" y="0" width="480" height="54" fill="#1A1D27"/>
  <circle cx="20" cy="27" r="6" fill="#10B981"/>
  <text x="34" y="32" font-family="Arial" font-size="13" font-weight="bold" fill="#10B981">Key Concepts — Standard ${code}</text>
  <line x1="0" y1="54" x2="480" y2="54" stroke="#2E3347" stroke-width="1"/>
  <text x="24" y="82" font-family="Arial" font-size="12" fill="#94A3B8">Focus on these important ideas:</text>
  ${kwBoxes}
  <line x1="14" y1="250" x2="466" y2="250" stroke="#2E3347" stroke-width="1"/>
  <text x="240" y="272" text-anchor="middle" font-family="Arial" font-size="12" fill="#94A3B8">Can you explain each concept in your own words? 🤔</text>
</svg>`;

  /* ── STEP 3: Try-it prompt ── */
  const step3Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
  <rect width="480" height="300" fill="#0F1117"/>
  <rect x="0" y="0" width="480" height="54" fill="#1A1D27"/>
  <circle cx="20" cy="27" r="6" fill="#F59E0B"/>
  <text x="34" y="32" font-family="Arial" font-size="13" font-weight="bold" fill="#F59E0B">Check Your Understanding</text>
  <line x1="0" y1="54" x2="480" y2="54" stroke="#2E3347" stroke-width="1"/>
  <rect x="14" y="68" width="452" height="100" rx="12" fill="rgba(99,102,241,0.07)" stroke="rgba(99,102,241,0.25)" stroke-width="1"/>
  <text x="240" y="96" text-anchor="middle" font-family="Arial" font-size="22">💬</text>
  <text x="240" y="124" text-anchor="middle" font-family="Arial" font-size="13" fill="#E2E8F0">In your own words, what does</text>
  <text x="240" y="146" text-anchor="middle" font-family="Arial" font-size="13" font-weight="bold" fill="#6366F1">Standard ${code}</text>
  <text x="240" y="164" text-anchor="middle" font-family="Arial" font-size="13" fill="#E2E8F0">ask you to be able to do?</text>
  <rect x="14" y="184" width="452" height="56" rx="10" fill="rgba(16,185,129,0.08)" stroke="rgba(16,185,129,0.3)" stroke-width="1"/>
  <text x="240" y="208" text-anchor="middle" font-family="Arial" font-size="12" fill="#10B981">✏️ Write your answer in the workspace below</text>
  <text x="240" y="228" text-anchor="middle" font-family="Arial" font-size="11" fill="#94A3B8">Your tutor will check it and guide you further!</text>
  <text x="240" y="272" text-anchor="middle" font-family="Arial" font-size="11" fill="#6366F1">🚀 Full animated visuals coming soon for this standard</text>
</svg>`;

  return {
    steps: [
      { title: `Standard ${code}`, svg: step1Svg, narration: `Let's look at what Standard ${code} is about. Read the learning objective carefully.` },
      { title: 'Key Concepts', svg: step2Svg, narration: `These are the key ideas in Standard ${code}. Make sure you understand each one.` },
      { title: 'Check Understanding', svg: step3Svg, narration: `Can you explain this standard in your own words? Use the workspace below to write your answer.` }
    ],
    altSteps: []
  };
}

/* ── GET /api/animations/:code ─────────────────────────────────────────── */
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const { data, error } = await supabase
      .from('learning_standards')
      .select('code, description, animation_steps, animation_alt_steps')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      console.error('Animation fetch error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!data) return res.status(404).json({ error: 'Standard not found' });

    // If we have generated steps, return them
    if (data.animation_steps && data.animation_steps.length > 0) {
      return res.json({
        code: data.code,
        description: data.description,
        steps: data.animation_steps,
        altSteps: data.animation_alt_steps || []
      });
    }

    // No stored steps yet — return auto-built placeholder
    const placeholder = buildPlaceholderSteps(data.code, data.description || code);
    return res.json({
      code: data.code,
      description: data.description,
      steps: placeholder.steps,
      altSteps: placeholder.altSteps,
      isPlaceholder: true
    });

  } catch (e) {
    console.error('Animation route error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
