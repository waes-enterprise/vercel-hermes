const { verifyKey } = require('discord-interactions');

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DEFAULT_MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4';

const SYSTEM_PROMPT = `You are Hermes, a helpful AI assistant built by WAES Enterprise. You help with coding, research, writing, analysis, math, and general questions. Be clear, helpful, and concise. Use markdown formatting.`;

const memory = new Map();
const MAX_MSGS = 12;

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function getMemory(key) {
  if (!memory.has(key)) memory.set(key, [{ role: 'system', content: SYSTEM_PROMPT }]);
  return memory.get(key);
}

function trimMemory(arr) {
  if (arr.length <= MAX_MSGS + 1) return arr;
  return [arr[0], ...arr.slice(-MAX_MSGS)];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp || !verifyKey(rawBody, signature, timestamp, PUBLIC_KEY)) {
      return res.status(401).send('Invalid signature');
    }

    const body = JSON.parse(rawBody);

    // PING
    if (body.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    // SLASH COMMAND
    if (body.type === 2) {
      const userId = body.member?.user?.id || body.user?.id;
      const channelId = body.channel_id;
      const memKey = `${userId}_${channelId}`;

      const opts = body.data.options || [];
      const opt = (name) => opts.find(o => o.name === name)?.value || '';
      const cmd = body.data.name;

      // ========== /ask ==========
      if (cmd === 'ask') {
        const userMsg = opt('message');
        if (!userMsg) {
          return res.json({ type: 4, data: { content: 'Usage: `/ask <your message>`' } });
        }

        if (!OPENROUTER_API_KEY) {
          return res.json({ type: 4, data: { content: 'Error: API key not configured.' } });
        }

        try {
          const hist = getMemory(memKey);
          hist.push({ role: 'user', content: userMsg });

          const aiResp = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://waes-enterprise.vercel.app',
              'X-Title': 'Hermes Discord Bot',
            },
            body: JSON.stringify({
              model: DEFAULT_MODEL,
              messages: trimMemory(hist),
              max_tokens: 1024,
              temperature: 0.7,
            }),
          });

          if (!aiResp.ok) {
            const errText = await aiResp.text();
            return res.json({ type: 4, data: { content: `AI error ${aiResp.status}` } });
          }

          const aiData = await aiResp.json();
          const reply = aiData.choices?.[0]?.message?.content || 'No response.';

          hist.push({ role: 'assistant', content: reply });
          memory.set(memKey, trimMemory(hist));

          return res.json({ type: 4, data: { content: reply } });
        } catch (err) {
          return res.json({ type: 4, data: { content: `Error: ${err.message}` } });
        }
      }

      // ========== Simple commands ==========
      if (cmd === 'new') {
        memory.delete(memKey);
        return res.json({ type: 4, data: { content: 'Conversation cleared!' } });
      }

      if (cmd === 'model') {
        return res.json({ type: 4, data: { content: `Model: \`${DEFAULT_MODEL}\`` } });
      }

      if (cmd === 'help') {
        return res.json({
          type: 4,
          data: {
            content: `**Commands:**\n- \`/ask <msg>\` — Chat with AI\n- \`/new\` — Clear chat\n- \`/model\` — Show model\n- \`/image <desc>\` — Make image\n- \`/help\` — This help\n\nModel: ${DEFAULT_MODEL}`,
          },
        });
      }

      if (cmd === 'image') {
        const prompt = opt('prompt');
        if (!prompt) return res.json({ type: 4, data: { content: 'Usage: `/image <description>`' } });
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
        return res.json({ type: 4, data: { content: `![${prompt}](${url})` } });
      }

      return res.json({ type: 4, data: { content: 'Unknown command.' } });
    }

    return res.status(400).send('Unhandled');
  } catch (e) {
    return res.status(500).send('Internal error');
  }
};
