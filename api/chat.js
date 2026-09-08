const BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.AI_MODEL || 'deepseek-chat';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: 'AI service is not configured' });

  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, 8) : [];
  if (!messages.length) return res.status(400).json({ error: 'Messages are required' });

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.88,
        response_format: req.body?.json ? { type: 'json_object' } : undefined,
      }),
      signal: AbortSignal.timeout(26000),
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error?.message || 'AI request failed' });
    return res.status(200).json({ content: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'AI request failed' });
  }
}
