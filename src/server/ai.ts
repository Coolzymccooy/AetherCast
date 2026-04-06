/**
 * AI API endpoints — server-side Gemini calls.
 * Keeps the API key out of the browser bundle.
 */
import { Router } from 'express';
import { sanitizeText } from './sanitize';

export function createAiRouter(): Router {
  const router = Router();

  router.post('/background', async (req, res) => {
    const { prompt } = req.body as { prompt?: unknown };
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt required' });
      return;
    }

    const sanitizedPrompt = sanitizeText(prompt, 200);

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await (ai.models as any).generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: `A high quality, professional studio background for a live stream. Theme: ${sanitizedPrompt}. Cinematic lighting, 4k resolution.` }] },
        config: { imageConfig: { aspectRatio: '16:9' } },
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (!part?.inlineData) {
        res.status(500).json({ error: 'No image generated' });
        return;
      }
      res.json({ imageUrl: `data:image/png;base64,${part.inlineData.data}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('AI background error:', message);
      res.status(500).json({ error: message });
    }
  });

  router.post('/direct', async (req, res) => {
    const { activeScene, scenes, telemetry } = req.body as {
      activeScene?: unknown;
      scenes?: unknown;
      telemetry?: { cpu?: number; bitrate?: number };
    };
    if (!activeScene || !scenes || !Array.isArray(scenes)) {
      res.status(400).json({ error: 'activeScene and scenes required' });
      return;
    }

    const sanitizedScene = sanitizeText(String(activeScene), 50);
    const sanitizedScenes = (scenes as unknown[]).map((s) => sanitizeText(String(s), 50));

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const promptText = `You are a professional broadcast director.
Current Scene: ${sanitizedScene}
Available Scenes: ${sanitizedScenes.join(', ')}
Telemetry: CPU ${telemetry?.cpu ?? 'N/A'}%, Bitrate ${telemetry?.bitrate ?? 'N/A'}

Decide if we should switch scenes for viewer engagement.
If yes, respond with ONLY the target scene name from the Available Scenes list.
If no switch needed, respond with exactly: STAY`;
      const response = await (ai.models as any).generateContent({ model: 'gemini-2.0-flash', contents: promptText });
      const decision = (response.text as string | undefined)?.trim() ?? 'STAY';
      res.json({ scene: decision });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('AI director error:', message);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
