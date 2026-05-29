import express from 'express';
const router = express.Router();

const AZURE_REGION = process.env.AZURE_TTS_REGION || 'southeastasia';
const AZURE_KEY = process.env.AZURE_TTS_KEY;
const VOICE_NAME = 'ms-MY-YasminNeural';
const SPEECH_RATE = '-15%';
const SPEECH_PITCH = '-5%';

router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const input = text.trim().slice(0, 4096);

    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ms-MY">
        <voice name="${VOICE_NAME}">
          <prosody rate="${SPEECH_RATE}" pitch="${SPEECH_PITCH}">
            ${input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          </prosody>
        </voice>
      </speak>`;

    const url = `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'LearnovaApp',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Azure TTS error:', errText);
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