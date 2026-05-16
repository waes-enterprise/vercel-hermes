const { verifyKey } = require('discord-interactions');
const crypto = require('crypto');

// Store hit logs in a simple file-like way (Vercel KV would be better but this works for diagnosis)
// We use a global variable — it persists within one serverless instance but resets on cold start
const hitLog = [];

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// This is the NEW discord endpoint — replaces the old one
// It logs EVERY request before processing
module.exports = async (req, res) => {
  const reqId = crypto.randomBytes(4).toString('hex');

  // Log ALL requests (before any processing)
  hitLog.push({
    id: reqId,
    time: new Date().toISOString(),
    method: req.method,
    path: req.url,
    sig: req.headers['x-signature-ed25519'] ? 'present' : 'missing',
    ts: req.headers['x-signature-timestamp'] || 'missing',
    ua: req.headers['user-agent']?.slice(0, 60) || 'none',
  });
  if (hitLog.length > 100) hitLog.shift();

  // GET = return hit log (for debugging)
  if (req.method === 'GET') {
    return res.json({ total: hitLog.length, hits: hitLog });
  }

  if (req.method !== 'POST') return res.status(405).send('No');

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

    // Update the log entry with body info
    const lastHit = hitLog[hitLog.length - 1];
    try {
      const body = JSON.parse(rawBody);
      lastHit.body_type = body.type;
      lastHit.cmd = body.data?.name || 'N/A';
      lastHit.has_opts = !!(body.data?.options?.length);
      lastHit.opt_vals = body.data?.options?.map(o => `${o.name}=${String(o.value).slice(0,30)}`) || [];
    } catch(e) {
      lastHit.parse_error = 'not json';
    }

    // Verify signature
    const sigValid = verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);
    lastHit.sig_valid = sigValid;

    if (!sigValid) {
      console.log(`[${reqId}] BAD SIG`);
      return res.status(401).send('Invalid signature');
    }

    const body = JSON.parse(rawBody);

    // PING
    if (body.type === 1) {
      console.log(`[${reqId}] PING`);
      return res.status(200).json({ type: 1 });
    }

    // SLASH COMMAND
    if (body.type === 2) {
      const cmd = body.data.name;
      const opts = body.data.options || [];
      const opt = (name) => opts.find(o => o.name === name)?.value || '';
      const userId = body.member?.user?.id || body.user?.id;
      const channelId = body.channel_id;
      const memKey = `${userId}_${channelId}`;

      console.log(`[${reqId}] CMD=${cmd} opts=${JSON.stringify(opts)}`);

      // Log the command hit
      lastHit.command = cmd;
      lastHit.handled = 'yes';

      // /ask
      if (cmd === 'ask') {
        const userMsg = opt('message');
        if (!userMsg) {
          return res.json({ type: 4, data: { content: 'Usage: `/ask <message>`' } });
        }

        try {
          const SYSTEM_PROMPT = 'You are Hermes, a helpful AI assistant by WAES Enterprise. Be concise.';
          const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
          const DEFAULT_MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4';

          const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
                { role: 'user', content: userMsg },
              ],
              max_tokens: 500,
            }),
          });

          lastHit.ai_status = aiResp.status;

          if (!aiResp.ok) {
            const err = await aiResp.text();
            lastHit.ai_error = err.slice(0, 100);
            return res.json({ type: 4, data: { content: `AI error ${aiResp.status}` } });
          }

          const aiData = await aiResp.json();
          const reply = aiData.choices?.[0]?.message?.content || 'No response.';
          lastHit.reply_ok = true;
          lastHit.reply_len = reply.length;

          return res.json({ type: 4, data: { content: reply } });
        } catch (err) {
          lastHit.error = err.message;
          return res.json({ type: 4, data: { content: `Error: ${err.message}` } });
        }
      }

      // help
      if (cmd === 'help') {
        return res.json({ type: 4, data: { content: '**Commands:**\n- `/ask <msg>` — Chat\n- `/help` — Help' } });
      }

      return res.json({ type: 4, data: { content: `Unknown: ${cmd}` } });
    }

    return res.status(400).send('Nope');
  } catch (e) {
    console.log(`[${reqId}] CRASH: ${e.message}`);
    const lastHit = hitLog[hitLog.length - 1];
    if (lastHit) lastHit.crash = e.message;
    return res.status(500).send('Error');
  }
};
