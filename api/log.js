// Endpoint that stores and returns logs from the discord handler
const logs = [];

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ logs, count: logs.length });
    return;
  }
  if (req.method === 'POST') {
    const entry = req.body;
    logs.push({ time: new Date().toISOString(), ...entry });
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method === 'DELETE') {
    logs.length = 0;
    res.status(200).json({ ok: true });
    return;
  }
  res.status(405).send('Method not allowed');
};
