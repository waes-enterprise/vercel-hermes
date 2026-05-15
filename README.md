# Hermes Discord Bot (Vercel)

A Discord AI chatbot powered by OpenRouter, deployed on Vercel's free tier.

## Commands
- `/ask <message>` - Chat with the AI
- `/new` - Clear conversation history
- `/model` - Show current model
- `/image <prompt>` - Generate an image
- `/help` - Show help

## Deploy to Vercel

1. Push this repo to GitHub
2. Import it on [vercel.com](https://vercel.com)
3. Add these environment variables:
   - `DISCORD_PUBLIC_KEY` - From Discord Developer Portal → Bot → Public Key
   - `DISCORD_BOT_TOKEN` - From Discord Developer Portal → Bot → Reset Token
   - `DISCORD_APPLICATION_ID` - From Discord Developer Portal → General Information → Application ID
   - `OPENROUTER_API_KEY` - Your OpenRouter API key
   - `DISCORD_ALLOWED_USERS` - Your Discord user ID (comma-separated for multiple)
   - `AI_MODEL` - (optional) Default: anthropic/claude-sonnet-4

## Register Slash Commands

After deploying, get your Application ID and Bot Token from the Discord Developer Portal, then run:
```
node setup-commands.js <APPLICATION_ID> <BOT_TOKEN>
```

## Invite Bot to Server

Generate an invite URL from the Discord Developer Portal:
- OAuth2 → URL Generator
- Scopes: `bot`, `applications.commands`
- Permissions: Send Messages, Read Message History, Attach Files, Add Reactions
