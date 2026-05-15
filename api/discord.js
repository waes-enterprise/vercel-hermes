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
const ALLOWED_USERS = process.env.DISCORD_ALLOWED_USERS
  ? process.env.DISCORD_ALLOWED_USERS.split(',').map(id => id.trim())
  : [];

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

async function callAI(messages) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key is not configured on Vercel. Check environment variables.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    console.log(`[AI] Calling ${DEFAULT_MODEL}...`);
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://waes-enterprise.vercel.app',
        'X-Title': 'Hermes Discord Bot',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        max_tokens: 800,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    console.log(`[AI] Status: ${resp.status}`);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[AI] Error: ${resp.status} - ${errText}`);
      throw new Error(`AI error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || 'No response generated.';
    console.log(`[AI] OK, ${content.length} chars`);
    return content;
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[AI] Failed: ${e.name}: ${e.message}`);
    if (e.name === 'AbortError') throw new Error('AI timed out. Try again.');
    throw e;
  }
}

function getMemory(key) {
  if (!memory.has(key)) memory.set(key, [{ role: 'system', content: SYSTEM_PROMPT }]);
  return memory.get(key);
}

function trimMemory(arr) {
  if (arr.length <= MAX_MSGS + 1) return arr;
  return [arr[0], ...arr.slice(-MAX_MSGS)];
}

async function editMessage(appId, token, content) {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[Discord] Edit failed: ${resp.status} - ${err}`);
  } else {
    console.log(`[Discord] Message edited OK`);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp || !verifyKey(rawBody, signature, timestamp, PUBLIC_KEY)) {
      return res.status(401).send('Invalid signature');
    }

    const interaction = JSON.parse(rawBody);
    const cmd = interaction.data?.name || 'N/A';
    console.log(`[Discord] type=${interaction.type} cmd=${cmd}`);

    // PING
    if (interaction.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    // SLASH COMMAND
    if (interaction.type === 2) {
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const channelId = interaction.channel_id;
      const memKey = `${userId}_${channelId}`;
      const appId = interaction.application_id;
      const token = interaction.token;

      if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) {
        return res.status(200).json({ type: 4, data: { content: 'Not authorized.', flags: 64 } });
      }

      const opts = interaction.data.options || [];
      const opt = (name) => opts.find(o => o.name === name)?.value || '';

      // === /ask ===
      if (cmd === 'ask') {
        const userMsg = opt('message');
        if (!userMsg) {
          return res.status(200).json({ type: 4, data: { content: 'Usage: `/ask <your message>`' } });
        }

        // Check API key exists
        if (!OPENROUTER_API_KEY) {
          return res.status(200).json({
            type: 4,
            data: { content: 'Bot not configured. OpenRouter API key missing on Vercel.' },
          });
        }

        try {
          const hist = getMemory(memKey);
          hist.push({ role: 'user', content: userMsg });

          // Call AI first, then respond
          const reply = await callAI(trimMemory(hist));
          hist.push({ role: 'assistant', content: reply });
          memory.set(memKey, trimMemory(hist));

          return res.status(200).json({ type: 4, data: { content: reply } });
        } catch (err) {
          console.error(`[Ask] Error: ${err.message}`);
          return res.status(200).json({
            type: 4,
            data: { content: `Error: ${err.message}` },
          });
        }
      }

      // === Simple commands ===
      if (cmd === 'new') {
        memory.delete(memKey);
        return res.status(200).json({ type: 4, data: { content: 'Conversation cleared!' } });
      }

      if (cmd === 'model') {
        return res.status(200).json({ type: 4, data: { content: `Model: \`${DEFAULT_MODEL}\`` } });
      }

      if (cmd === 'help') {
        return res.status(200).json({
          type: 4,
          data: {
            content: `**Commands:**\n- \`/ask <msg>\` — Chat with AI\n- \`/new\` — Clear chat\n- \`/model\` — Show model\n- \`/image <desc>\` — Make image\n- \`/help\` — This help\n\nModel: ${DEFAULT_MODEL}`,
          },
        });
      }

      if (cmd === 'image') {
        const prompt = opt('prompt');
        if (!prompt) {
          return res.status(200).json({ type: 4, data: { content: 'Usage: `/image <description>`' } });
        }
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
        return res.status(200).json({ type: 4, data: { content: `![${prompt}](${url})` } });
      }

      return res.status(200).json({ type: 4, data: { content: 'Unknown command.' } });
    }

    return res.status(400).send('Unhandled');
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    return res.status(500).send('Internal error');
  }
};
