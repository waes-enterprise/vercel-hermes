const crypto = require('crypto');

// Config: disable Vercel's body parser so we get the raw body for Discord verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// OpenRouter API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Discord keys
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Settings
const DEFAULT_MODEL = process.env.AI_MODEL || 'anthropic/claude-sonnet-4';
const ALLOWED_USERS = process.env.DISCORD_ALLOWED_USERS
  ? process.env.DISCORD_ALLOWED_USERS.split(',').map(id => id.trim())
  : [];

const SYSTEM_PROMPT = `You are Hermes, a helpful AI assistant built by WAES Enterprise. You can help with coding, research, writing, analysis, math, and general questions. Be clear and helpful. Use markdown formatting when appropriate. Keep responses concise but thorough.`;

const memory = new Map();
const MAX_MSGS = 16;

// Verify Discord's Ed25519 signature
function verifySignature(body, signature, timestamp) {
  try {
    const timestampData = Buffer.from(timestamp);
    const bodyData = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
    const message = Buffer.concat([timestampData, bodyData]);
    const pubKey = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY, 'hex'), format: 'der', type: 'spki' });
    // Discord uses raw Ed25519 public key (64 bytes), not DER
    const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(PUBLIC_KEY, 'hex').toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    const verify = crypto.createVerify('sha256');
    verify.update(message);
    return verify.verify(pem, signature, 'base64');
  } catch (e) {
    console.error('Verify error:', e.message);
    return false;
  }
}

// Actually, use the discord-interactions library which handles Ed25519 properly
let verifyKeyFn;
try {
  const { verifyKey } = require('discord-interactions');
  verifyKeyFn = (body, sig, ts) => verifyKey(body, sig, ts, PUBLIC_KEY);
} catch (e) {
  verifyKeyFn = null;
}

function verify(body, signature, timestamp) {
  if (verifyKeyFn) return verifyKeyFn(body, signature, timestamp);
  return verifySignature(body, signature, timestamp);
}

// Read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function callAI(messages) {
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
      max_tokens: 1500,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || 'No response generated.';
}

function editMessage(token, content) {
  return fetch(
    `https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }
  );
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // Read raw body for signature verification
    const rawBody = await getRawBody(req);

    // Verify Discord signature
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp || !verify(rawBody, signature, timestamp)) {
      console.error('Signature verification failed');
      return res.status(401).send('Invalid signature');
    }

    const interaction = JSON.parse(rawBody);

    // Type 1: PING (Discord verification)
    if (interaction.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    // Type 2: APPLICATION_COMMAND (slash commands)
    if (interaction.type === 2) {
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const channelId = interaction.channel_id;
      const memKey = `${userId}_${channelId}`;

      // Auth check
      if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) {
        return res.status(200).json({
          type: 4,
          data: { content: 'Not authorized.', flags: 64 }
        });
      }

      const cmd = interaction.data.name;
      const opts = interaction.data.options || [];
      const opt = (name) => opts.find(o => o.name === name)?.value || '';

      // /ask - Chat with AI
      if (cmd === 'ask') {
        const userMsg = opt('message');
        if (!userMsg) {
          return res.status(200).json({
            type: 4,
            data: { content: 'Usage: `/ask <your message>`' }
          });
        }

        // Respond immediately (deferred)
        const token = interaction.token;
        res.status(200).json({ type: 5 });

        // Then call AI and edit the deferred message
        try {
          const hist = getMemory(memKey);
          hist.push({ role: 'user', content: userMsg });
          const reply = await callAI(trimMemory(hist));
          hist.push({ role: 'assistant', content: reply });
          memory.set(memKey, trimMemory(hist));
          await editMessage(token, reply);
        } catch (err) {
          console.error('AI Error:', err.message);
          await editMessage(token, `Error: ${err.message}`);
        }
        return;
      }

      // /new - Clear conversation
      if (cmd === 'new') {
        memory.delete(memKey);
        return res.status(200).json({
          type: 4,
          data: { content: 'Conversation cleared! Use `/ask` to start fresh.' }
        });
      }

      // /model - Show current model
      if (cmd === 'model') {
        return res.status(200).json({
          type: 4,
          data: { content: `Current model: \`${DEFAULT_MODEL}\`` }
        });
      }

      // /help - Show commands
      if (cmd === 'help') {
        return res.status(200).json({
          type: 4,
          data: {
            content: `**Hermes Bot Commands:**\n- \`/ask <message>\` — Chat with AI\n- \`/new\` — Clear conversation\n- \`/model\` — Show current model\n- \`/image <prompt>\` — Generate an image\n- \`/help\` — Show this help\n\nModel: ${DEFAULT_MODEL}`
          }
        });
      }

      // /image - Generate image
      if (cmd === 'image') {
        const prompt = opt('prompt');
        if (!prompt) {
          return res.status(200).json({
            type: 4,
            data: { content: 'Usage: `/image <description>`' }
          });
        }
        const token = interaction.token;
        res.status(200).json({ type: 5 });
        try {
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
          await editMessage(token, `Here's your image:\n![${prompt}](${url})`);
        } catch (err) {
          await editMessage(token, `Error: ${err.message}`);
        }
        return;
      }

      return res.status(200).json({
        type: 4,
        data: { content: 'Unknown command.' }
      });
    }

    return res.status(400).send('Unhandled interaction type');

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      type: 4,
      data: { content: `Error: ${error.message}` }
    });
  }
};
