// Test endpoint: simulates a /ask command WITHOUT Discord signature verification
// This isolates whether the /ask handler logic is the problem or the signature/Discord forwarding

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4';
const SYSTEM_PROMPT = 'You are Hermes, a helpful AI assistant by WAES Enterprise. Be concise.';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Use POST');

  try {
    const { message } = req.body || {};
    const userMsg = message || 'hello';

    if (!OPENROUTER_API_KEY) {
      return res.json({ step: 'check-key', ok: false, error: 'No API key' });
    }

    // Step 1: Call AI
    const t0 = Date.now();
    const aiResp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://waes-enterprise.vercel.app',
        'X-Title': 'Hermes Test',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 200,
      }),
    });

    const elapsed = Date.now() - t0;

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.json({ step: 'ai-call', ok: false, elapsed_ms: elapsed, error: errText.slice(0, 300) });
    }

    const aiData = await aiResp.json();
    const reply = aiData.choices?.[0]?.message?.content || 'No response.';

    // Step 2: Format as Discord response (type 4 = ChannelMessageWithSource)
    const discordResponse = {
      type: 4,
      data: { content: reply },
    };

    return res.json({
      step: 'complete',
      ok: true,
      elapsed_ms: elapsed,
      model: DEFAULT_MODEL,
      reply_length: reply.length,
      reply_preview: reply.slice(0, 200),
      discord_response: discordResponse,
      // Would Discord accept this? Let's check format:
      discord_type_valid: discordResponse.type === 4,
      discord_has_content: !!discordResponse.data.content,
    });
  } catch (e) {
    return res.json({ step: 'crash', ok: false, error: e.message });
  }
};
