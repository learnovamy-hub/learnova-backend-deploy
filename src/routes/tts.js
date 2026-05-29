import express from 'express';
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { text, voice = 'nova' } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const input = text.trim().slice(0, 4096);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input,
        voice,
        speed: 0.85,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI TTS error:', errText);
      return res.status(response.status).json({ error: 'TTS generation failed' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(Buffer.from(value));
      }
    };
    await pump();

  } catch (e) {
    console.error('TTS route error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'TTS server error' });
  }
});

export default router;