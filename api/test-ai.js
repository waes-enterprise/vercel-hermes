// Direct AI test - bypasses Discord, calls OpenRouter directly from Vercel
module.exports = async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.AI_MODEL || 'anthropic/claude-haiku-4';

  if (!key) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });
  }

  try {
    console.log(`[Test] Calling ${model}...`);
    const start = Date.now();

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://waes-enterprise.vercel.app',
        'X-Title': 'Hermes Test',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
        max_tokens: 100,
      }),
    });

    const elapsed = Date.now() - start;
    const data = await resp.json();

    res.status(200).json({
      status: resp.status,
      elapsed_ms: elapsed,
      model,
      ai_response: data.choices?.[0]?.message?.content || null,
      error: data.error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
