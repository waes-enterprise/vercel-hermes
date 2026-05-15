const { verifyKey } = require('discord-interactions');

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('No');

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['x-signature-ed25519'];
    const ts = req.headers['x-signature-timestamp'];

    const valid = verifyKey(rawBody, sig, ts, PUBLIC_KEY);
    console.log(`sig_valid=${valid} type=unknown len=${rawBody.length}`);

    if (!valid) return res.status(401).send('Bad sig');

    const body = JSON.parse(rawBody);
    console.log(`parsed type=${body.type}`);

    if (body.type === 1) {
      console.log('PING');
      return res.status(200).json({ type: 1 });
    }

    if (body.type === 2) {
      const cmd = body.data.name;
      const opts = body.data.options || [];
      console.log(`COMMAND: ${cmd} opts=${JSON.stringify(opts)}`);

      // EVERY command returns the same way for testing
      if (cmd === 'ask') {
        const msg = opts.find(o => o.name === 'message')?.value || '';
        console.log(`ASK: msg="${msg}"`);
        return res.status(200).json({
          type: 4,
          data: { content: `Echo: "${msg}" — bot is working!` },
        });
      }

      if (cmd === 'help') {
        return res.status(200).json({
          type: 4,
          data: { content: '**Commands:**\n- `/ask <msg>` — Chat\n- `/help` — Help' },
        });
      }

      console.log(`UNKNOWN CMD: ${cmd}`);
      return res.status(200).json({
        type: 4,
        data: { content: `Unknown command: ${cmd}` },
      });
    }

    console.log(`UNKNOWN TYPE: ${body.type}`);
    return res.status(400).send('Unknown type');
  } catch (e) {
    console.log(`CRASH: ${e.message}\n${e.stack}`);
    return res.status(500).send('Crash');
  }
};
