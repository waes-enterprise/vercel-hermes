// Debug endpoint - check env vars and bot status
module.exports = async (req, res) => {
  const envStatus = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? `Set (${process.env.OPENROUTER_API_KEY.slice(0, 8)}...)` : 'NOT SET',
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY ? `Set (${process.env.DISCORD_PUBLIC_KEY.slice(0, 8)}...)` : 'NOT SET',
    AI_MODEL: process.env.AI_MODEL || 'anthropic/claude-haiku-4 (default)',
    NODE_ENV: process.env.NODE_ENV || 'not set',
    VERCEL_REGION: process.env.VERCEL_REGION || 'not set',
  };

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: envStatus,
  });
};
