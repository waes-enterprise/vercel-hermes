const APP_ID = '1504852990421635092';
const BOT_TOKEN = process.argv[2];

if (!BOT_TOKEN) {
  console.error('Usage: node add-ping.js <bot_token>');
  process.exit(1);
}

async function main() {
  // Register /ping command
  const resp = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'ping',
      description: 'Test if the bot is alive',
    }),
  });

  const data = await resp.json();
  if (resp.ok) {
    console.log('Registered /ping:', data.name);
  } else {
    console.error('Failed:', resp.status, data);
  }
}

main();
