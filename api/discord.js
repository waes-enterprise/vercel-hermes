const { verifyKey } = require('discord-interactions');

// OpenRouter API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Discord public key for verification
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

// Default model
const DEFAULT_MODEL = process.env.AI_MODEL || 'anthropic/claude-sonnet-4';

// Allowed users (comma-separated IDs, leave empty for open access)
const ALLOWED_USERS = process.env.DISCORD_ALLOWED_USERS
  ? process.env.DISCORD_ALLOWED_USERS.split(',').map(id => id.trim())
  : [];

// System prompt
const SYSTEM_PROMPT = `You are Hermes, a helpful AI assistant built by WAES Enterprise. You can help with coding, research, writing, analysis, math, and general questions. Be clear and helpful. Use markdown formatting when appropriate. Keep responses concise but thorough.`;

// Simple conversation memory (survives across requests within a cold start)
const memory = new Map();
const MAX_MSGS = 16;

function verifySignature(body, signature, timestamp) {
  return verifyKey(body, signature, timestamp, PUBLIC_KEY);
}

async function callAI(messages, model) {
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://waes-enterprise.vercel.app',
      'X-Title': 'Hermes Discord Bot',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
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

async function sendFollowup(token, content) {
  await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
}

async function editFollowup(token, content) {
  await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${token}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
}

function getMemory(key) {
  if (!memory.has(key)) {
    memory.set(key, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  return memory.get(key);
}

function trimMemory(arr) {
  if (arr.length <= MAX_MSGS + 1) return arr;
  return [arr[0], ...arr.slice(-(MAX_MSGS))];
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature, timestamp)) {
      return res.status(401).send('Bad signature');
    }

    const interaction = typeof req.body === 'string' ? JSON.parse(rawBody) : req.body;

    // PING
    if (interaction.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    // APPLICATION_COMMAND
    if (interaction.type === 2) {
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const channelId = interaction.channel_id;
      const memKey = `${userId}_${channelId}`;

      // Auth check
      if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) {
        return res.status(200).json({
          type: 4,
          data: { content: 'You are not authorized to use this bot.', flags: 64 }
        });
      }

      const cmd = interaction.data.name;
      const opts = interaction.data.options || [];
      const opt = (name) => opts.find(o => o.name === name)?.value || '';

      // /ask command
      if (cmd === 'ask') {
        const userMsg = opt('message');
        if (!userMsg) {
          return res.status(200).json({
            type: 4,
            data: { content: 'Usage: `/ask <your message>`' }
          });
        }

        // Immediately acknowledge with thinking indicator
        // Then process AI call and send followup
        const token = interaction.token;

        // Fire and forget - respond first, then call AI
        res.status(200).json({
          type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        });

        // Now call AI (this runs even after response is sent on Vercel)
        try {
          const hist = getMemory(memKey);
          hist.push({ role: 'user', content: userMsg });
          const trimmed = trimMemory(hist);
          const reply = await callAI(trimmed, DEFAULT_MODEL);
          hist.push({ role: 'assistant', content: reply });
          memory.set(memKey, trimMemory(hist));

          // Send followup with the AI response
          await editFollowup(token, reply);
        } catch (aiErr) {
          console.error('AI Error:', aiErr.message);
          await editFollowup(token, `Error getting response: ${aiErr.message}`);
        }
        return; // already responded
      }

      // /new command
      if (cmd === 'new') {
        memory.delete(memKey);
        return res.status(200).json({
          type: 4,
          data: { content: 'Conversation cleared! Start fresh with `/ask`.' }
        });
      }

      // /model command
      if (cmd === 'model') {
        return res.status(200).json({
          type: 4,
          data: { content: `Current model: \`${DEFAULT_MODEL}\`` }
        });
      }

      // /help command
      if (cmd === 'help') {
        return res.status(200).json({
          type: 4,
          data: {
            content: `**Hermes Bot Commands:**\n• \`/ask <message>\` — Chat with AI\n• \`/new\` — Clear conversation\n• \`/model\` — Show current model\n• \`/help\` — Show this help\n\nModel: ${DEFAULT_MODEL}`
          }
        });
      }

      // /image command
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
          // Use Pollinations.ai for free image generation
          const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
          await editFollowup(token, `Here's your image:\n![${prompt}](${imageUrl})`);
        } catch (err) {
          await editFollowup(token, `Error generating image: ${err.message}`);
        }
        return;
      }

      return res.status(200).json({
        type: 4,
        data: { content: 'Unknown command.' }
      });
    }

    return res.status(400).send('Unhandled');

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      type: 4,
      data: { content: `Something went wrong: ${error.message}` }
    });
  }
};
