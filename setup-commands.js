// setup-commands.js
// Run: node setup-commands.js <APPLICATION_ID> <BOT_TOKEN>
// This registers the slash commands with Discord

const APPLICATION_ID = process.argv[2];
const BOT_TOKEN = process.argv[3];

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error('Usage: node setup-commands.js <APPLICATION_ID> <BOT_TOKEN>');
  console.error('');
  console.error('Find these in https://discord.com/developers/applications');
  console.error('  APPLICATION_ID = "General Information" page');
  console.error('  BOT_TOKEN = "Bot" page → "Reset Token"');
  process.exit(1);
}

const commands = [
  {
    name: 'ask',
    description: 'Chat with Hermes AI',
    options: [
      {
        name: 'message',
        description: 'Your message to the AI',
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: 'new',
    description: 'Start a fresh conversation (clear history)',
  },
  {
    name: 'model',
    description: 'Show the current AI model',
  },
  {
    name: 'image',
    description: 'Generate an image from a description',
    options: [
      {
        name: 'prompt',
        description: 'Describe the image you want',
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: 'help',
    description: 'Show all available commands',
  },
];

async function registerCommands() {
  // PUT to /commands with an array registers ALL commands in one request
  const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (resp.ok) {
      const data = await resp.json();
      console.log(`Registered ${data.length} commands:`);
      data.forEach(c => console.log(`  /${c.name} - ${c.description}`));
    } else {
      const err = await resp.text();
      console.error(`Failed: ${resp.status} - ${err}`);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }

  console.log('\nDone! Slash commands are now available in your server.');
  console.log('Make sure you invited the bot with "applications.commands" scope.');
}

registerCommands();
