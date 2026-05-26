import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { correctBMTranscript, quickCorrectBM } from '../lib/bm_correction_engine.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

/**
 * POST /api/transcript/correct-bm
 * Full 4-layer BM correction pipeline.
 *
 * Body: { transcript: string, skip_claude?: boolean, verbose?: boolean }
 * Returns: { corrected: string, layers?: object }
 */
router.post('/correct-bm', async (req, res) => {
  try {
    const { transcript, skip_claude = false, verbose = false } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript (string) required' });
    }
    if (transcript.length > 50000) {
      return res.status(400).json({ error: 'transcript too long (max 50,000 chars)' });
    }

    const result = await correctBMTranscript(transcript, anthropic, {
      skipClaude: skip_claude,
      verbose,
    });

    res.json(result);
  } catch (err) {
    console.error('[Transcript] correct-bm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transcript/quick-correct-bm
 * Layers 1-3 only (no Claude). Instant, free, good for real-time preview.
 *
 * Body: { transcript: string }
 * Returns: { corrected: string }
 */
router.post('/quick-correct-bm', (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript (string) required' });
    }
    const corrected = quickCorrectBM(transcript);
    res.json({ corrected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transcript/correct-bm-batch
 * Correct multiple transcripts. Uses quick-correct (no Claude) for each.
 * Body: { transcripts: string[] }
 */
router.post('/correct-bm-batch', (req, res) => {
  try {
    const { transcripts } = req.body;
    if (!Array.isArray(transcripts)) {
      return res.status(400).json({ error: 'transcripts (array) required' });
    }
    const results = transcripts.map(t => ({
      original: t,
      corrected: quickCorrectBM(t),
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
