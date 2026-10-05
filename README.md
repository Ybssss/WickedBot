# WickedBot

A Telegram bot for an anonymous confession channel, built as a single Google Apps Script file.
Users DM the bot commands; it posts to the channel and leaves a Gemini-generated comment
under each post.

## How it works

The bot **polls** Telegram rather than using a webhook.

```
1-min trigger → pollTelegram_ → getUpdates → dedupe by update_id → handleMessage
                                                                     ├─ private chat  → commands
                                                                     ├─ channel post  → auto-reply (if enabled)
                                                                     └─ anything else → "talk to me in private"
```

A time-based trigger calls `pollTelegram_` once a minute. This is deliberate: Apps Script's
`ContentService` always answers an incoming webhook with a **302 redirect**, and Telegram
counts anything that is not 2XX as a failed delivery — so it retried the same update
indefinitely and only the first one ever got processed. `doPost` still exists in the file but
nothing calls it. **Do not switch back to `setupWebhook`.**

The trade-off is latency: expect up to ~60 seconds between sending a message and getting a
reply.

## Commands

| Command | Args | Access | Description |
| --- | --- | --- | --- |
| `/start` | — | Everyone | Welcome message. |
| `/help` | — | Everyone | List commands, and show whether auto-reply is on. |
| `/comment` | `<text>` | Everyone | Generate a comment and post it to the channel. |
| `/roast` | `<text>` | Everyone | Alias for `/comment`. |
| `/confess` | `<message>` | Everyone | Post an anonymous confession, then comment on it. |
| `/reply` | `<message_id> [hint]` | Everyone | Comment under a specific channel post. |
| `/setchannel` | `<channel_id>` | Admin only | Show or set the confession channel. |

`/comment`, `/confess` and `/reply` are rate-limited to 5 per minute per user. Anything that
isn't a slash command gets "Only commands. Type /help."

## Setup

1. **Create a Telegram bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot`,
   and copy the token.

2. **Get a Gemini API key.** Visit [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   and create a key.

3. **Create the Apps Script project.** Open [https://script.google.com](https://script.google.com),
   click "New project", and delete any default files. Create **one** file named exactly
   `Code` and paste the entire contents of `Code.gs` into it.

   The multi-file editor proved unreliable for this project; keeping everything in one file
   is a deliberate decision, not an accident. Don't split it back up.

4. **Enable the manifest.** Project settings → tick "Show `appsscript.json` manifest in
   editor", and replace the generated manifest with the one from this repo.

5. **Set script properties.** Project settings → Script properties:

   | Key | Required | Notes |
   | --- | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | yes | From step 1. |
   | `GEMINI_API_KEY` | yes | From step 2. Without it every comment falls back to "I had nothing to say for once." |
   | `ADMIN_IDS` | yes | Comma-separated numeric Telegram user ids. Get yours from [@userinfobot](https://t.me/userinfobot). |
   | `CONFESSION_CHANNEL_ID` | no | Numeric like `-1001234567890`, or `@channelname`. Can also be set later via `/setchannel`. |
   | `AUTO_REPLY` | no | Set to `true` (case-insensitive, surrounding spaces ignored) to comment on every new channel post. Anything else, or unset, means off. |
   | `GEMINI_MODEL` | no | Overrides the default model. |
   | `WEBHOOK_SECRET` | no | If set, the webhook URL gains `?secret=` and `doPost` rejects requests without a matching secret or `X-Webhook-Secret` header. |

   `POLL_OFFSET` is written automatically — don't set it by hand.

6. **Make the bot an admin of the channel.** It needs permission to post messages there.

7. **Start polling.** In the editor, select `setupPolling` and click Run. Authorize when
   prompted. This deletes any webhook and installs the 1-minute trigger. Run `registerCommands`
   once so the `/` menu is populated.

   A web app deployment is **not** needed for polling — only the (broken) webhook path uses one.

8. **Verify.** DM the bot `/start`, then `/help`. Then `/confess hello world` and check the
   channel.

## Auto-reply

With `AUTO_REPLY=true`, every non-command text post in the configured channel gets a comment
threaded under it. Anything starting with `/` is skipped, and posts with no `text` (photos,
videos — which carry `caption` instead) are skipped and logged as `channel_media_skipped`.

`AUTO_REPLY` is read through one helper and compared after trimming and lowercasing, so
`true`, `TRUE` and ` true ` all enable it. Anything else means off.

Note that channel posts normally carry `sender_chat` rather than `from`, so any code touching
a channel post must not assume `from` exists. **In particular, `sender_chat` is the *channel*
for every channel post — including the bot's own** — so there is no field that distinguishes
the bot's comments from a user's. Telegram echoes a channel's posts back through `getUpdates`,
so without a guard the bot answers its own comment and loops. The bot therefore records the
`message_id` returned by `sendMessage` and skips those; they are logged as `own_post_ignored`.

## Diagnosing silence

If the bot stops replying, run **`diagnose`** from the editor dropdown (Run → `diagnose`) and
read View → Logs. It only reads — it sends no message and writes no property — and it checks,
in order: the token (via `getMe`), whether a **webhook is still armed** (this makes `getUpdates`
return 409, so polling receives nothing), whether the `pollTelegram_` trigger exists, the channel
id, `AUTO_REPLY`, channel reachability, whether the bot is an admin in the channel, and the last
rows of the log sheet. The final line names the first thing to fix.

The most common causes, in order:

1. **`AUTO_REPLY` is not `true`** — channel posts are then ignored *by design*.
2. **A webhook is still registered** — `getUpdates` returns 409 and nothing is ever received.
3. **The `pollTelegram_` trigger is missing** — run `setupPolling`.
4. **The bot is not an admin in the channel** — every post fails with 403.
5. **The deployed file is stale** — re-paste `Code.gs` (see below).

## Tests

`node tests/run.js` runs the real `Code.gs` against stubs for the Apps Script services and
reports a pass/fail total. It catches reference errors, wrong argument shapes and logic faults
without a deployment. It does **not** talk to Telegram or Google Sheets, so a green run means
the logic is right, not that the bot replied.

## Model

Defaults to `gemini-2.5-flash-lite`, overridable with the `GEMINI_MODEL` property. Prompts
ask for one short plain-text comment with no markdown and no emoji, at temperature 0.9, with
Gemini's safety filters set to block only high-severity harassment and hate speech.

If Gemini errors, is unreachable, or returns nothing usable, the bot falls back to a fixed
string rather than failing the command.

## Debugging

- **Log sheet** — every update is appended to the `logs` tab of spreadsheet
  `174KDDCMnU5CwAOr0bxuzQHD-L5wrV2C14dObwgFIPWc` with the parsed command and the action
  taken. Logging happens *after* the reply is sent; calling Sheets before replying is what
  caused the original retry storm.
- **Mock harness** — `testParse`, `testCmdHelp`, `testHandleHelp`, `testHelpPayload_`,
  `debugDoPostHelp` and `debugAll_` run from the editor without any Telegram traffic. Check
  View → Logs or Executions afterwards.
- **`diagnose`** — run from the editor dropdown for a read-only report on why the bot is silent.
  See "Diagnosing silence" above.
- **Regression suite** — `node tests/run.js` (see "Tests" above).
- `stopPolling` removes the trigger and deliberately does not re-arm the webhook.

## Privacy and security

- `/confess` is anonymous in the practical sense — readers see the bot as the sender, not the
  original user. It is not anonymous in a cryptographic sense.
- Confession text and comment topics are sent to Google Gemini. Don't put anything sensitive
  through it.
- Secrets live in Script Properties, not in source. Anyone with edit access to the script
  project can read them, so restrict who can edit.
- The Gemini key that was used during initial development was exposed in a chat transcript and
  should be considered compromised. Rotate keys at
  [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) if you ever repeat
  that mistake.

## Local development with clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then set your scriptId
clasp push
clasp open
```

`.clasp.json` is gitignored. Note that pushing overwrites what's in the editor — since the
deployed copy has drifted from the repo before, confirm they match before debugging behaviour.

## License

MIT
