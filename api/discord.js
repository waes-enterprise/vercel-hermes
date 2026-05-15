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

const SYSTEM_PROMPT = `You are Hermes, a helpful AI assistant built by WAES Enterprise. Be clear, helpful, and concise.`;

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp || !verifyKey(rawBody, signature, timestamp, PUBLIC_KEY)) {
      return res.status(401).send('Bad sig');
    }

    const body = JSON.parse(rawBody);

    if (body.type === 1) return res.status(200).json({ type: 1 });

    if (body.type === 2) {
      const cmd = body.data.name;
      const opts = body.data.options || [];
      const val = opts[0]?.value || '';

      console.log(`CMD: ${cmd} | OPTS: ${JSON.stringify(opts)}`);

      // /ask — DIAGNOSTIC MODE: hardcoded response first
      if (cmd === 'ask') {
        console.log(`ASK RECEIVED: "${val}"`);

        if (!OPENROUTER_API_KEY) {
          return res.json({ type: 4, data: { content: 'No API key set on Vercel.' } });
        }

        // Try AI call with a short timeout
        try {
          console.log('Calling AI...');
          const aiResp = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://waes-enterprise.vercel.app',
              'X-Title': 'Hermes',
            },
            body: JSON.stringify({
              model: DEFAULT_MODEL,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: val },
              ],
              max_tokens: 200,
              temperature: 0.7,
            }),
          });

          console.log(`AI status: ${aiResp.status}`);

          if (!aiResp.ok) {
            const err = await aiResp.text();
            console.log(`AI error: ${err}`);
            return res.json({ type: 4, data: { content: `AI error ${aiResp.status}` } });
          }

          const aiData = await aiResp.json();
          const reply = aiData.choices?.[0]?.message?.content || 'Empty reply';
          console.log(`AI reply: ${reply.slice(0, 100)}`);

          return res.json({ type: 4, data: { content: reply } });
        } catch (err) {
          console.log(`ASK FAILED: ${err.message}`);
          return res.json({ type: 4, data: { content: `Failed: ${err.message}` } });
        }
      }

      if (cmd === 'help') {
        return res.json({ type: 4, data: { content: '**Commands:**\n- `/ask <msg>` — Chat with AI\n- `/help` — Show this' } });
      }

      return res.json({ type: 4, data: { content: `Unknown: ${cmd}` } });
    }

    return res.status(400).send('Nope');
  } catch (e) {
    console.log(`CRASH: ${e.message}`);
    return res.status(500).send('Error');
  }
};
