// Ping counter — every request to the discord endpoint increments this
// Check with GET /api/hitlog
let hits = [];
const MAX = 50;

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.json({ total: hits.length, recent: hits.slice(-20) });
  }
  if (req.method === 'DELETE') {
    hits = [];
    return res.json({ ok: true });
  }
  res.status(405).send('Use GET');
};

// Export a function for discord.js to call
module.exports.record = function(type, cmd, sig) {
  hits.push({
    time: new Date().toISOString(),
    type,
    cmd: cmd || 'N/A',
    has_sig: !!sig,
  });
  if (hits.length > MAX) hits = hits.slice(-MAX);
};
