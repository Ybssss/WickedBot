# Roasting Bot

A Telegram bot that roasts you on command and posts anonymous confessions to a Telegram channel, deployed as a Google Apps Script web app. The bot receives Telegram updates via webhook, forwards roast requests to Google Gemini, and reposts the result to a configured confession channel.

## Overview

When a user sends `/roast <something>` to the bot, the message is sent to Google Gemini which generates a roast. When a user sends `/confess <message>`, the message is posted anonymously to the configured Telegram channel. The bot is admin-gated for channel configuration via `/setchannel`.

The whole thing runs serverless on Google Apps Script, so there is no server to host, no database to maintain, and no payment required beyond Google's free tier.

## Features

| Command | Description | Access |
| --- | --- | --- |
| `/start` | Welcome message and quick help. | Everyone |
| `/help` | List of available commands. | Everyone |
| `/roast <name or text>` | Generate a roast of the given name or text via Gemini. | Everyone |
| `/confess <message>` | Anonymously post a message to the configured confession channel. | Everyone |
| `/setchannel <channel_id>` | Set the confession channel id at runtime. | Admin only |

## Prerequisites

- A Telegram account.
- A Google account (for Apps Script).
- A Telegram channel where you are an admin, and where the bot is also an admin (required for the bot to post messages).

## Setup

1. **Get a Telegram bot token.** Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts. Copy the token it gives you.

2. **Get a Gemini API key.** Visit [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with your Google account, and click "Create API key". Copy the key.

3. **Create the Apps Script project.** Open [https://script.google.com](https://script.google.com) and click "New project". Name it `RoastingBot` (or anything you prefer).

4. **Add the source files.** In the script editor, create the following files and paste the corresponding contents into each:
   - `Config.gs`
   - `Telegram.gs`
   - `Gemini.gs`
   - `Bot.gs`

5. **Enable the manifest.** In the script editor, click the gear icon (Project settings), then enable "Show `appsscript.json` manifest in editor". Replace the auto-generated `appsscript.json` with the one from this repo.

6. **Set script properties.** Still in Project settings, scroll to "Script properties" and add the following keys:
   - `TELEGRAM_BOT_TOKEN` — the token from step 1.
   - `GEMINI_API_KEY` — the key from step 2.
   - `ADMIN_IDS` — your numeric Telegram user id. Get it by messaging [@userinfobot](https://t.me/userinfobot) on Telegram. To allow multiple admins, separate ids with commas (e.g. `123456789,987654321`).
   - `CONFESSION_CHANNEL_ID` — optional. The id of the channel where confessions will be posted. You can also set this later via `/setchannel`. Numeric ids look like `-1001234567890`; public channels can use `@channelname`.

7. **Deploy as a web app.** In the script editor, click "Deploy" -> "New deployment". Choose type "Web app". Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
   
   Click "Deploy" and copy the resulting web app URL.

8. **Register the webhook.** In the script editor, select the function `setupWebhook` from the toolbar and click "Run". You will be prompted to authorize the script the first time. This registers the GAS web app URL as the Telegram bot's webhook, so Telegram knows where to deliver updates.

9. **Configure the channel.** In a private chat with your bot, send `/setchannel -1001234567890` (use your actual channel id). The bot must already be an admin in the channel. Skip this step if you already set `CONFESSION_CHANNEL_ID` in step 6.

10. **Verify.** Send `/start` to the bot. You should get a welcome message. Send `/help` to see the command list. Send `/roast my code` to test Gemini integration. Send `/confess hello world` to test channel posting.

## Commands reference

| Command | Args | Description |
| --- | --- | --- |
| `/start` | none | Show welcome message. |
| `/help` | none | List commands. |
| `/roast` | `<name or text>` | Generate a roast via Gemini. |
| `/confess` | `<message>` | Anonymously post to the configured channel. |
| `/setchannel` | `<channel_id>` | Set the confession channel id. Admin only. |

## Model note

The script defaults to `gemini-2.5-flash-lite`. The earlier choice of `gemini-3.1-flash-lite` is not a publicly released model name; the 2.5 flash-lite tier is the current equivalent in the Gemini model family as of this writing. You can override the model at any time by setting the `GEMINI_MODEL` script property to any valid Gemini model id (for example `gemini-2.5-pro` or `gemini-2.0-flash`).

## Privacy and security

- The bot posts to the configured channel as itself; channel readers see the message as coming from the bot, not from the original user. `/confess` is therefore not literally anonymous in the strict cryptographic sense, but it is anonymous in the practical sense that other channel members do not see who sent it.
- Roast requests and confession text are sent to Google Gemini for processing. Gemini may log inputs according to its [terms of service](https://ai.google.dev/terms). If this is a concern, do not send sensitive information through the bot.
- The bot token and Gemini API key are stored in Apps Script properties. Anyone with edit access to the script project can read them. Restrict script edit access accordingly.
- The web app is deployed with `Anyone` access because Telegram's webhook delivery is unauthenticated. Restrict the script's `doPost` logic to only accept POSTs from Telegram (validate the source IP or a secret token in the URL).

## Local development with clasp

You can edit the script locally and push changes to Apps Script using [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json
# edit .clasp.json to set your scriptId
clasp push
clasp open
```

`.clasp.json` is gitignored to keep your script id private.

## License

MIT
