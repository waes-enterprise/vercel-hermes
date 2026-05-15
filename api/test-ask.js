// Test /ask without Discord — directly calls the same AI logic
module.exports = async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.AI_MODEL || 'anthropic/claude-haiku-4';

  if (!key) return res.status(500).json({ error: 'No API key' });

  try {
    const msg = req.query.msg || 'Hello, who are you?';
    console.log(`[test-ask] msg="${msg}" model=${model}`);

    const t0 = Date.now();
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
        messages: [
          { role: 'system', content: 'You are Hermes, a helpful AI assistant. Be concise.' },
          { role: 'user', content: msg },
        ],
        max_tokens: 200,
      }),
    });

    const elapsed = Date.now() - t0;
    const data = await resp.json();

    // Return the EXACT format discord.js would return
    const discordResponse = {
      type: 4,
      data: {
        content: data.choices?.[0]?.message?.content || 'No response',
      },
    };

    res.status(200).json({
      ai_ok: resp.ok,
      elapsed_ms: elapsed,
      model,
      reply: discordResponse.data.content,
      error: data.error || null,
      // This is what would be sent to Discord:
      discord_would_send: discordResponse,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
