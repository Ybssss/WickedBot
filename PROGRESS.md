# PROGRESS — WickedBot

> ## ⚠️ READ THIS FILE FIRST — BEFORE TOUCHING THE SYSTEM
>
> **Owner instruction.** This file is the accumulated state of the project: what is built, what is only
> planned, what was tried and rejected, and which claims in the code and in older documents are already
> known to be wrong. Read it, then verify the specific claim you are about to rely on, in source.
>
> **Latest state (2026-09-18):** All ten findings from the 2026-09-15 review are closed and committed as
> `f4a2068`, which is pushed (HEAD is `ee7628f`, 0 commits ahead of `origin/master`). The bot is verified
> working in **polling mode** as of 2026-09-06; nothing since has been run live — `f4a2068` is verified by
> syntax check and reading only. Remaining work is deployment and live verification (in the owner's GAS
> editor, not here). Most urgent: **rotate the Telegram bot token now** — two raw tokens sit in the pushed
> git history on GitHub (see section 5), and the Gemini API key was exposed in chat on 2026-09-02 and
> should be rotated too. Start with section 4 (progress), section 5 (drift), then section 6
> (verification baseline). Docs note (2026-09-18): the legacy "orchestrator / worker role-play"
> framing was stripped from this file (preamble + worker-persona labels; technical facts, hashes and
> timestamps kept). That doc cleanup is uncommitted until you commit it.

---

## 0. Standing rules — how this project runs

These are owner instructions, not findings. They apply to every change.

1. **Read this file first.** Before any change — not after, not only when unsure. Then verify the claim
   you rely on in source; a claim here can be stale, and section 6 lists the ones already known to be.
2. **This file is the single maintained document.** Do not create `CONTEXT.md`, `docs/`, ADR folders or
   any second documentation file. Glossary and decisions live here.
3. **Always maintain and append to it.** A change — code, schema, workflow, config — is not
   complete until this file reflects it. **Append; never overwrite history.** When a recorded claim is
   overtaken, add a superseding entry and mark the original _superseded_ rather than deleting it.
   Keep the "Latest state" pointer at the top current.
4. **Commit and push are the user's decision.** Never commit or push without the owner's explicit
   approval for that specific change. Approval for one commit does not extend to the next. Know what a
   push triggers (CI deploys) before asking.
5. **Initialise CodeGraph for the project** and use it before grep or reading files, for both questions
   and edits (it shows callers and blast radius). Treat a "nothing calls this" conclusion as a lead to
   verify — unresolved references hide callers.
6. **Frontend.** If `DESIGN.md` exists it is the UI reference, and frontend work is built with the
   **`/ui-ux-pro-max`** skill. Use the design tokens (CSS custom properties), never raw palette classes.
   Status is never colour-only; every input keeps a label; focus is always visible.
   _Not active in this project: this is a single-file Apps Script bot and no `DESIGN.md` exists._
7. **Development** uses the **`/implement`** skill. If it is not installed, record that here and proceed
   under the remaining rules.
8. **Keep the project modular — for expandability.** The system grows by _adding_ modules, not by growing
   existing ones. See section 1.
9. **Report outcomes faithfully.** Say _verified_ only for what was executed, and name how
   ("suite 120/0/2", "queried read-only", "generated SQL inspected"). Otherwise write _not verified_ and
   what would verify it. A green run proves only what the tests exercise.
10. **Never paste secret-shaped strings into this file** — not even to document a false positive.
    Describe them. Pasting one re-triggers the secret scanner on the commit that documents it.
11. **Write "section N", never the section-sign glyph.**

### 1. Modularization

- **Whole bot is one file.** Settled decision D1: everything lives in `Code.gs`. "Modularization" here
  means clean separation of concerns inside that file — constants/config, Telegram ingress and routing,
  command handlers, Gemini generation, sheet logging, polling — with genuinely private helpers
  underscore-suffixed and the editor mock harness at end of file.
- **Registration.** A command is not reachable until it is wired into `handleMessage`'s routing.
  Add new commands there, not in an invisible side branch.
- **Shared code lives in shared places.** Do not copy a helper into a second handler; promote it.
  The auto-reply logic must route through `handleMessage` (one listener), not an inline duplicate —
  the duplicated copy was the buggy live one (finding #10, fixed 2026-09-15).
- **Practical test before adding code:** if the change needs another module's internals, or duplicates
  logic that exists elsewhere, stop — the feature belongs in that module, or the shared piece is
  promoted first.

---

## 2. Decisions

Settled decisions, numbered. Reversing or clarifying one means **appending a new row**, never rewriting.
Mark items the owner delegated to the agent as _(delegated)_.

| #      | Decision | Outcome |
| ------ | -------- | ------- |
| **D1** | Single-file `Code.gs`. | The multi-file GAS editor proved unreliable (truncated/stale file copies caused most "bugs"). Everything lives in one file. |
| **D2** | camelCase function names. | No trailing underscore except genuinely private helpers (`pollTelegram_`, `logToSheet_`, `mockPrivateMsg_`). Underscore names caused editor parse/registration trouble in 2026-09-02. |
| **D3** | Default model `gemini-2.5-flash-lite`, overridable via `GEMINI_MODEL`. | `gemini-3.1-flash-lite` was a typo, not a real model. |
| **D4** | Secrets live in Script Properties only. | `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_IDS`, `CONFESSION_CHANNEL_ID`, `AUTO_REPLY`. Nothing hardcoded. |
| **D5** | Ingress is polling — webhook is dead and stays dead. | GAS `ContentService` 302 echo is treated as non-2XY by Telegram → serial retry queue blocks everything after the first update. Polling (`pollTelegram_` + `setupPolling` + 1-min trigger) shipped 2026-09-06 and is the only live path. `setupWebhook` remains only for reference; `stopPolling()` must never re-arm it. |
| **D6** | Dedupe by `update_id` (600 s CacheService). | Ignore `is_bot` messages and non-slash channel chatter. `doPost` dedupe landed 2026-09-03 (`b6ba428`). |
| **D7** | Sheet logging stays off the reply hot path. | Logging goes to spreadsheet `174KDDCMnU5CwAOr0bxuzQHD-L5wrV2C14dObwgFIPWc`. Pre-reply `SpreadsheetApp` calls caused the retry flood (2026-09-03); reply happens before any sheet write. |
| **D8** | Channel auto-reply routes through a single listener. | `pollTelegram_` forwards `channel_post` to `handleMessage`; with `AUTO_REPLY` off, channel posts are ignored silently (`chat.type === 'channel'` guard), not nagged into the channel. |
| **D9** | Web app deployment access must be **Anyone**, `/exec`. | `/dev` and non-Anyone web hooks are auth-walled (401/302). Hardcoded `WEBHOOK_URL_` points at the `/exec` deployment. Web deployment is only needed for the webhook path, which is not live (D5). |
| **D10** | Tokens in git history cannot be redacted away. | The 2026-09-02/03 leak means the token must be **revoked and rotated**; redaction only cleaned the working file. Same for the Gemini key exposed in chat. |

## 3. Glossary

| Term | Meaning in this project |
| ---- | ----------------------- |
| `doPost` | Web app entry point (webhook path). Now effectively unreachable — ingress is polling (D5). |
| `pollTelegram_` | Polling loop: `getUpdates` with Offset in `PropertiesService`, dedupe+wiring into `handleMessage`. |
| `setupPolling` / `stopPolling` | Arm / disarm the 1-minute trigger. `stopPolling` must **not** call `setupWebhook` (fixed 2026-09-15). |
| `setupWebhook` / `WEBHOOK_URL_` | Dead webhook path, reference only. |
| `handleMessage` | Single router: private commands, channel auto-reply, channel-ignore early return. |
| `cmdStart` / `cmdHelp` / `cmdComment` / `cmdRoast` / `cmdConfess` / `cmdReply` / `cmdSetChannel` | Command handlers. `/roast` is a `/comment` alias. |
| `generateComment` / `generateRoast` | Gemini wrapper (`gemini-2.5-flash-lite` default, D3). |
| `checkRateLimit` | Per-user rate limiter applied to `cmdComment` / `cmdConfess` / `cmdReply`. |
| `update_id` / dedupe | 600 s `CacheService` dedupe of Telegram updates (D6). |
| `AUTO_REPLY` | Script property: toggles threaded auto-comment under new channel posts (default false/unset). |
| `CONFESSION_CHANNEL_ID` | Script property; current value `-1001957164507`. |
| `ADMIN_IDS` | Script property; current value `1790450430`. |
| `LOG_SHEET_ID` | Spreadsheet `174KDDCMnU5CwAOr0bxuzQHD-L5wrV2C14dObwgFIPWc`; logging off the hot path (D7). |
| mock harness | Editor-only mocks (`mockPrivateMsg_`, `testParse`, `testCmdHelp`, `testHandleHelp`, `testHelpPayload_`, `debugDoPostHelp`, `debugAll_`) for webhook-free debugging in View → Logs. |
| GAS 302 echo | `ContentService` always redirects to `script.googleusercontent.com`; Telegram reads it as non-2XY and serial-retries. Root cause of the 2026-09-03 webhook saga. |
| CodeGraph | Local code index: `codegraph.json` (maps `.gs` → javascript) + `.codegraph/codegraph.db`. Use `codegraph sync` after edits. |
| `sender_chat`-not-`from` | Telegram quirk relevant to channel posts — see README. |

---

## 4. Progress & Work Plan

Status labels: ✅ complete · 🟡 partial · 🔴 blocked / defect · ⏳ planned. Newest entries at the end.

### ✅ Item 1: Bootstrap, plan, parallel build — first Apps Script version (2026-09-02)

**What / why.** Owner request: Telegram bot integrating Gemini to roast people in an anonymous Telegram
confession channel. First plan (2026-09-02T00:00:30Z) was Python (`python-telegram-bot`, `google-genai`,
`.env` for secrets); revised 00:01:00Z to **Google Apps Script V8, webhook-driven** (Config.gs, Telegram.gs,
Gemini.gs, Bot.gs, appsscript.json, README, .gitignore, .clasp.json.example).
**Changed.** Initial 10-file scaffold built in parallel (2026-09-02T00:02:00Z); file sizes and function
contracts verified (00:02:30Z); flag: the
user pasted the real Gemini key into chat — not hardcoded anywhere, key described as compromised.
**Decision(s).** D3 (default model), D4 (Script Properties).
**Verified.** 2026-09-02T00:02:30Z grep confirmed the real Gemini key is not in any file; function
contracts all present; no Python to import so `/implement` verification not applicable.
**Not done / open.** None.
**Supersedes.** none.

### ✅ Item 2: Single-file restructure + rename to WickedBot (2026-09-02)

**What / why.** Multi-file GAS editor proved unreliable. Plan v2 (00:03:00Z): user reported a
`function nihao(){};` injection from a broken manual paste; underscore-suffixed names cleaned to
camelCase; collapsed into one `Code.gs` so the deployed file is bulletproof. User confirmed `ConfessionBot`
uses a single-file pattern.
**Changed.** One `Code.gs` (commit `72876b4`, then `3668985` case fix, `09ff5a8` docs, `dc41ccc` cleanup —
`Code.gs` 19,396 bytes, 29 functions, no underscore names). Bot renamed `RoastingBot` → `WickedBot`
(2026-09-02T03:40:00Z, `robocopy /MOVE` to `C:\Users\YB\Projects\WickedBot\`; old directory remains a
locked empty tomb, harmless).
**Decision(s).** D1, D2.
**Verified.** 29 functions, `doPost` present, `handleMessage` routes; `node --check` clean; `/start`
responds live (`CommentBot` welcome) 2026-09-02.
**Not done / open.** `/help` remained silent live until the deployed file was repasted — the user's editor
copy was truncated (not a code bug).
**Supersedes.** Item 1's multi-file layout.

### ✅ Item 3: First push + Gemini key incident (2026-09-02T03:45:00Z)

**What / why.** Configure `origin` → github.com/Ybssss/WickedBot and push.
**Changed.** Initial commit `74d0a57` pushed to `master`.
**Decision(s).** D10.
**Verified.** GitHub push protection blocked the first attempt because PROGRESS.md briefly contained the
real Gemini key; key redacted and commit amended; `git grep` clean.
**Not done / open.** Key was visible in chat — treat as compromised; rotate at aistudio.google.com/apikey.
**Supersedes.** none.

### ✅ Item 4: First deploy, em-dash, registerCommands, truncation saga (2026-09-02T03:46:00Z)

**What / why.** User provided GAS project URL, web app URL, bot token, key, admin id. Webhook registered
(getWebhookInfo confirmed). `/start` worked but `/help` was silent — root cause: em-dash U+2014 in
`cmdHelp_` rejected by the Telegram HTML parser.
**Changed.** Replaced `—` with `&mdash;` in Bot.gs; added `registerCommands_` in Telegram.gs; committed
`4c89cd1` + push. Multiple re-deploys failed: deployed `Bot.gs` in editor was truncated, "no function" in
the dropdown — led to the single-file restructure (Item 2).
**Decision(s).** D1, D2.
**Verified.** `/start` ok live; `/help` silent; `setupWebhook`/`registerCommands` returned 200.
**Not done / open.** Deployed-file truncation resolved by D1; retried as single `Code.gs`.
**Supersedes.** none.

### ✅ Item 5: Webhook saga I — `/dev` URL and token mismatch (2026-09-03)

**What / why.** `/start` still silent under webhook. getWebhookInfo revealed the webhook pointed at a
**`/dev` URL** (`AKfycbw1fd62...` — a different, auth-walled deployment) and the token had changed
`8972406236` → `8945572488`.
**Changed.** Patched `setupWebhook`: `url.replace(/\/dev$/, '/exec')` at `Code.gs:54-55` — resolves to
`AKfycbyYL3Wg.../exec` (commit `7bfaffc`, pushed 2026-09-03T01:32:28Z).
**Decision(s).** D9.
**Verified.** SetupWebhook ran from the editor returned `/dev`; after patch it resolves to `/exec`.
**Not done / open.** Webhook still auth-walled; see Item 7.
**Supersedes.** none.

### 🟡 Item 6: Spam flood → dedupe by update_id (2026-09-03)

**What / why.** After Item 5, `/start` repeated 3x plus ghost sends at 9:30/9:31 — webhook now reached
`/exec` but deduplication was missing; `/help` mis-routed to the `/start` reply. 7 messages in the log
(9:29 `/start` → 3x CommentBot, 9:29 `/help` → 1x CommentBot, 9:30–9:31 ghost CommentBot ×3).
Immediate stop via `deleteWebhook`.
**Changed.** `doPost` dedupe by `update_id` (600 s cache), `handleMessage` ignores `is_bot`, channel_post
early return. `Code.gs` 404 lines (+16 dedupe), commit `b6ba428` pushed (2026-09-03T01:38:58Z).
**Decision(s).** D6.
**Verified.** Post-`deleteWebhook` no repeats; dedupe verified working in later mock runs.
**Not done / open.** Retry-loop root cause (GAS 302) still open — see Item 8.
**Supersedes.** Item 5's assumption that reaching `/exec` fixed delivery.

### ✅ Item 7: Sheet logging for spam debugging (2026-09-03)

**What / why.** Plan published (01:43:35Z) to log every webhook update + command result for spam/009ee
debugging, to spreadsheet `174KDDCMnU5CwAOr0bxuzQHD-L5wrV2C14dObwgFIPWc`.
**Changed.** `Code.gs` gained `LOG_SHEET_ID`/logs sheet + `logToSheet_`/`logUpdate_` + hooks in
`doPost`/`handleMessage`; `appsscript.json` added `spreadsheets` oauthScope. Commit `f46a0b2` pushed
(01:53:07Z).
**Decision(s).** D7.
**Verified.** Deployed and auth'd; sheet logs later provided decisive triage evidence (Items 8–9).
**Not done / open.** Logging caused its own retry flood → deferred off hot path (Item 9).
**Supersedes.** none.

### 🔴 Item 8: Webhook saga II — 401 / 302 whack-a-mole (2026-09-03)

**What / why.** `setupWebhook` logged 200 but `getWebhookInfo` showed `AKfycbw1.../exec` 401 pending 1
(02:10:44Z — deployment not Anyone). Correct exec confirmed by user as `AKfycbyYL3Wg.../exec`
(02:14:38Z); 302 Found pending 3+ repeated even after the user switched "Who has access" to Anyone —
deployment mismatch / not republished / not a new version. `doPost` never executed (no Executions log).
**Changed.** Hardcoded `WEBHOOK_URL_` to the correct `/exec` (commit `6c338bb`). Flushed queue,
reset webhook with `drop_pending_updates` repeatedly.
**Decision(s).** D9.
**Verified.** States cycled through 200/pending 0 → 302/pending 3–4 → 200/pending 0 → 302/pending 4.
One `/start` after a flush got a reply, then it re-302'd.
**Not done / open.** This is a platform dead end — see Item 9 for the real root cause and the polling
fallback.
**Supersedes.** Item 5/Item 8's "just point at the right URL" theory.

### ✅ Item 9: Root cause — GAS 302 echo vs Telegram 2XY; logging deferred; mock harness; polling decided (2026-09-03)

**What / why.** Sheet logs (02:40:45Z) proved it: update `29357111` retried 10× over 12 min,
`29357114` 7×; `/help` pending 4 never delivered. Recon (05:28–05:45Z, re-reading
core.telegram.org/bots/api): **Telegram requires a 2XY webhook response; GAS `ContentService` always
answers 302 to `script.googleusercontent.com`** — Telegram treats that as failed delivery and
serial-retries, so only the first update ever gets through. GAS 302 is by design, not a bug.
**Changed.**
 1. Logging deferred off the reply hot path: commit `81d59cc` (removed `doPost_received` pre-log),
    `e4255c3` (removed `parsed_`/`dispatch_` pre-logs) — reply now happens before `SpreadsheetApp`.
 2. Editor mock harness appended (03:03:16Z, commit `bcfbf10`): `mockPrivateMsg_`,
    `testParse`, `testCmdHelp`, `testHandleHelp`, `testHelpPayload_`, `debugDoPostHelp`, `debugAll_`
    (460 lines). Found + fixed `TextOutput.getResponseCode` TypeError (`Code.gs:454`);
    `debugDoPostHelp` hit `duplicate_ignored` on stale cached id `9999991` → harness `freshId` random.
 3. `cmdHelp` entity fix (04:36:14Z, commit `623e45a`):
    `&mdash;` renders literally in Telegram HTML mode → back to U+2014 `.`
 4. Polling fallback planned (05:50:19Z) and shipped 2026-09-06 — see Item 10.
**Decision(s).** D5, D7, D8.
**Verified.** Mocks pass (`testCmdHelp`/`testHandleHelp` ok); live `/help` still blocked by the 302 queue —
proving the divergence is the webhook, not the handler.
**Not done / open.** Nothing — superseded by polling.
**Supersedes.** Items 5, 8 — the entire webhook path.

### ✅ Item 10: Polling fallback shipped (2026-09-06) — retroactively logged

**What / why.** Three commits shipped without PROGRESS entries; recorded in the 2026-09-06T17:00:00+08:00
catch-up entry, superseding the unlogged-commit drift.
**Changed.** `bcb3d91` polling fallback (`pollTelegram_`/`setupPolling`/`stopPolling`, Offset in
PropertiesService, 1-min trigger) replacing the broken webhook; `38dde04` replay-loop fix (poll dedupe +
offset fix + trigger cleanup + sheet cache / deferred log / atomic offset / auto-reply fix);
`395f6c4` allow anonymous `channel_post` with no `msg.from` to trigger a reply.
**Decision(s).** D5, D7, D8.
**Verified.** `Code.gs` at 28,788 bytes, 39 functions — **polling path verified live 2026-09-06**; webhook
path retained but unused.
**Not done / open.** Live behaviour after `395f6c4` not re-verified (this is the last "verified working"
point; everything after is syntax/read-only).
**Supersedes.** Item 9's webhook attempt; also covers the stale PROGRESS entries for `bcb3d91`/`38dde04`/`395f6c4`.

### ✅ Item 11: CodeGraph initialised (2026-09-15T17:35:00+08:00)

**What / why.** Rule 5 — initialise and use CodeGraph before grep/reads.
**Changed.** `codegraph init` v1.6.0; first pass indexed **0 files** (`.gs` is not a built-in extension);
added `codegraph.json` mapping `".gs": "javascript"`; re-ran `codegraph index`: 1 file, 53 nodes, 183
edges (41 functions, 9 constants, 2 variables).
**Decision(s).** none.
**Verified.** `codegraph query doPost` → `Code.gs:368`; `codegraph callees doPost` → `logUpdate_`,
`handleMessage`, `sendMessage`.
**Not done / open.** `.codegraph/codegraph.db` (0.35 MB) + `codegraph.json` were untracked;
caveat recorded: never `git rm` under `.codegraph/` (its `.gitignore` be  removed via `codegraph uninit`,
not `git rm`). Committed with Item 14.
**Supersedes.** none.

### ✅ Item 12: Orientation code review — six new findings (2026-09-15T18:00:00+08:00)

**What / why.** Read `Code.gs` end to end (525 lines, 39 functions) plus `appsscript.json`,
`CHANGELOG.md`, re-read `README.md` against code. Read-only orientation.
**Changed.** No code changes. Findings #5–#10:
 1. Unguarded `update.channel_post.from.is_bot` at line 106 → auto-reply throws on anonymous posts.
 2. Literal `&mdash;` at line 258 (the 2026-09-03 fix had regressed from U+2014? — no: this is the
    leftover mirror; fixed in Item 13).
 3. `stopPolling()` re-enables the dead webhook by calling `setupWebhook()`.
 4. `USE_POLLING_` dead constant.
 5. README describes a 4-file layout and a `/roast`-era command set that no longer exist.
 6. Auto-reply logic duplicated, only the buggy copy live; `cmdReply` unrate-limited.
**Decision(s).** none (review).
**Verified.** `doPost` confirmed unreachable; mock harness (`testParse`…`debugAll_`) is editor-only.
**Not done / open.** All six closed by Items 13–14.
**Supersedes.** none.

### ✅ Item 13: Fix batch #1 (2026-09-15T18:10:00+08:00)

**What / why.** Close findings (1), (2), (3) and the duplication half of (6) from Item 12.
**Changed.** All in `Code.gs`:
 1. `pollTelegram_` (line 102-108) — deleted the duplicated inline auto-reply block; forwards
    `update.channel_post` to `handleMessage` alongside `update.message`, so the only listener is the
    correctly-guarded one. Added `msg.chat.type === 'channel'` early return in `handleMessage`
    (line 425, logs `channel_ignored`) so with `AUTO_REPLY` off, channel posts are ignored silently
    instead of getting the "Please talk to me in a private chat" nag posted into the channel.
 2. `cmdHelp` line 258 — `&mdash;` → U+2014; same swap in `testHelpPayload_` mirror.
 3. `stopPolling()` — removed the trailing `setupWebhook()` call; it only deletes triggers now.
**Decision(s).** D5, D8.
**Verified.** Syntax-checked by copying to a `.js` temp and running `node --check` (GAS `.gs` extension
rejected outright — copy first). `codegraph sync` clean: 1 changed file, 53 nodes. Grep: no `&mdash;`
remains, no unguarded `.from.is_bot`, only the definition of `setupWebhook` remains.
**Not done / open.** Uncommitted at this point; deploy + live verify pending.
**Supersedes.** Item 12 findings (1)–(3) and the duplication half of (6).

### ✅ Item 14: Fix batch #2 + README rewrite + commit f4a2068 (2026-09-15)

**What / why.** Close the last findings from Item 12 and commit everything (batch #2 at
2026-09-15T19:25:00+08:00; commit 19:58:00+08:00).
**Changed.**
 1. Removed the dead `USE_POLLING_` constant.
 2. Added `checkRateLimit(msg.from.id, 'reply')` to `cmdReply`, matching `cmdComment`/`cmdConfess`.
 3. Rewrote `README.md` completely: polling (not webhook), single-file `Code` layout with an explicit
    "don't split it up" note, real command set incl. `/roast` as `/comment` alias, Script Properties
    table, `AUTO_REPLY` behaviour, `sender_chat`-not-`from` gotcha, log sheet, mock harness, and that a
    web app deployment is only needed for the webhook path.
 4. `CHANGELOG.md` updated; PROGRESS findings + token redactions.
 5. `.gitignore` gained `.workbuddy-ai/`.
 6. Committed as `f4a2068` — `Code.gs` (both fix batches), `README.md`, `CHANGELOG.md`, `PROGRESS.md`,
    `.gitignore`, `codegraph.json`, `.codegraph/.gitignore`. 7 files changed, +218/-70.
**Decision(s).** D5, D7, D8.
**Verified.** `node --check` clean (via `.js` temp copy); `codegraph sync` reports 52 nodes (down from 53 —
exactly the removed constant). Pre-commit secret scan
(`git grep -E "AIza[0-9A-Za-z_-]{20,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}"`): 2 hits before redaction, 0 after.
**Not done / open.** Deployment + live verification remain (owner's GAS editor). Push of `f4a2068` was
recorded as "deliberately not pushed" on 2026-09-15 but is now pushed — see section 5 for the supersession.
**Supersedes.** Item 12 findings (4)–(6); Item 11's "untracked" state.

### ⏳ Item 15: Rotate secrets, deploy, verify live, push (open — next steps)

**What / why.** Remaining work is deployment and verification, not code. Nothing has run live since
2026-09-06 polling verification.
**Changed.** None yet — owners' editor work.
**Decision(s).** D10.
**Verified.** not verified.
**Not done / open.** In strict order:
 1. **Rotate the Telegram bot token via BotFather** (`/revoke`, then `/token`); update the
    `TELEGRAM_BOT_TOKEN` script property. Two raw tokens are in pushed git history (section 5).
 2. Rotate the Gemini API key exposed in chat on 2026-09-02 (aistudio.google.com/apikey).
 3. Paste `Code.gs` into the GAS editor as the single file `Code`; New deployment → Anyone; run
    `setupPolling`.
 4. Set `AUTO_REPLY=true`; confirm `/help` shows a real dash and a channel post gets a threaded comment.
 5. `git push` once verified (currently HEAD `ee7628f`, 0 ahead — nothing to push unless more changes land).
**Supersedes.** none.

---

## 5. Known drift and superseded claims

Claims in code comments, older documents or earlier entries that are known to be wrong. Anything
remembered from a superseded source is unverified until re-checked.

| Source | Claim | Reality | Disposition |
| ------ | ----- | ------- | ----------- |
| Item 14 / old status snapshot (2026-09-15) | `f4a2068` "committed but not pushed; branch is 1 commit ahead of origin/master" | As of 2026-09-18 `git status` is clean and 0 commits ahead of origin/master; HEAD is `ee7628f` | **superseded 2026-09-18** — already pushed |
| Old webhook-path docs/entries (≈`AKfycbw1.../dev`) | Webhook is the live ingress; just point it at the right URL | GAS 302 echo makes webhook unusable | **superseded 2026-09-06** by polling (D5) |
| README before 2026-09-15 rewrite | 4-file layout, `/roast`-era command set, tells you to run `setupWebhook` | Single file, polling, real command set | **superseded 2026-09-15** (Item 14) |
| Early docs | `gemini-3.1-flash-lite` is a real model | Typo; default is `gemini-2.5-flash-lite` (D3) | **superseded** — D3 |
| PROGRESS.md on 2026-09-02/03 | Raw Telegram bot tokens could be recorded in this file | Two raw tokens entered the **pushed** git history; redaction does not rewrite history | **open security issue** — revoke token via BotFather, rotate (D10) |
| 2026-09-15 items | "all ten findings closed" while deployed editor copy was still stale | Repo is fixed; the **deployed** `Code.gs` may still be a truncated/stale paste | **drift** — re-paste verified against HEAD before debugging live bugs |
| `setupWebhook` still present in `Code.gs` | The code may look like webhook is live | Reference only; ingress is polling; `stopPolling()` no longer re-arms it | **known dead path** — do not re-enable without re-opening D5 |

## 6. Verification baseline

| Check | Command | Last result | Date |
| ----- | ------- | ----------- | ---- |
| Syntax check | copy `Code.gs` → `.js`, `node --check` | clean | 2026-09-15 |
| CodeGraph index | `codegraph sync` | 52 nodes (1 file) | 2026-09-15 |
| Secret scan | `git grep -E "AIza[0-9A-Za-z_-]{20,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}"` | 2 hits before redaction → 0 after | 2026-09-15 |
| Git state | `git status` / `git log --oneline -5` | clean, HEAD `ee7628f`, 0 ahead of origin/master | 2026-09-18 |
| Live polling E2E | DM `/start`, `/help`, `/comment`, `/confess`; channel post → threaded reply | ✅ verified 2026-09-06; **not re-verified since** | 2026-09-06 |
| Live webhook deploy | — | N/A — webhook path abandoned (D5) | — |

---

## Appendix A — Lessons carried over from earlier projects

Generic failure modes that cost real time before. Check each when the matching work comes up.

**Deploy**

- A config baked into a shared image (e.g. an docker) points every environment at one place.
  Mount per-environment config instead.
- A health gate shorter than the probe interval fails on every real deploy and passes on no-ops. Poll.
- Add `concurrency` and `timeout-minutes` to deploy jobs, retry flaky pulls, and record what image is
  running after each deploy.
- Recreate dependent containers together when a proxy resolves its upstream once at startup.

**Process**

- "Feature-complete" is not "done": security, deployment, records and cutover belong in the definition
  of done, not at the tail.
- Record unverified inferences as inferences, and check them before building on them.

**This project — WickedBot**

- **GAS webhook 302 is by design.** `ContentService` always echoes 302; Telegram treats non-2XY as a
  failed delivery and serial-retries, blocking every following update. Never burn time on it again —
  the polling path (D5) is the fix, already shipped.
- **The deployed editor copy is the real production state.** Verify the deployed `Code.gs` matches HEAD
  before debugging "logic bugs" — most WickedBot bugs were a truncating provider: an editor paste.
- **Secrets pasted into logs/chat cannot be un-published.** Redaction only cleans the working tree;
  revocation is the only fix (D10). Never paste secret-shaped strings here (rule 10).
- **`node --check` rejects the `.gs` extension outright** (`ERR_UNKNOWN_FILE_EXTENSION`). Copy to a
  `.js` temp file first; that one-liner has caught every real syntax regression since 2026-09-15.

---

## Appendix Z — Webhook secret hardening (2026-09-18)

**What / why.** `doPost` accepted any POST with no authentication. Unauthenticated hits would be
processed like real Telegram updates, and a replay of an old `update_id` only needed an unauthenticated
call to be trust-modelled. `WEBHOOK_SECRET` now gates the webhook path.

**Changed (Code.gs only, uncommitted).**
- New `WEBHOOK_SECRET` optional script property (documented in header + README property table).
- `setupWebhook` appends `?secret=<encoded>` to the webhook URL and logs `secretSet=` (never the URL).
- New `webhookSecret_()` and `isWebhookAuthed_(e)` helpers. Check compares the `secret` query param or
  `X-Webhook-Secret` header, case-insensitive; property unset ⇒ always deny.
- `doGet(e)` now returns `deny_()` (no GET ingress ever).
- `doPost` gate: missing/incorrect secret → log `doPost: missing secret (secretSet=0|1)` + `deny_()`.
- Channel auto-reply now sends HTML-escaped `postCommentHtml_()` text and is rate-limited by
  `channelReplyQuotaHit_()` (ScriptCache `rl_channel_<minute>` floor; `CHANNEL_REPLY_MIN_HARD_=15`/min,
  mutes for the remainder of the minute, with a console log).
- `cmdConfess` / `cmdReply` / `postCommentToChannel` use `postCommentHtml_` (HTML-escaped, reply-style).
- `debugDoPostHelp` now exercises the auth gate: no-secret → deny, wrong-secret → deny, matching secret
  → normal path, repeated identical update → `duplicate_ignored`.

**Checked (2026-09-18).**
- `node --check` on a temp `.js` copy of `Code.gs`: clean.
- Secret scan over working tree: 0 hits.
- CodeGraph `sync`: 61 nodes, 1 file modified.

**Not done / open.** Owner must paste into the GAS editor (single file `Code`), then set/deploy as Item
15. Webhook path is reference-only (polling is live per D5) — `WEBHOOK_SECRET` protects it anyway and
stays harmless. Commit + push pending owner. Incident report for the leaked Telegram tokens delivered
2026-09-18; rotation, history purge (`09ff5a8`, `64cefc7`, `f4a2068`, `7bfaffc`, `543618d`) and alert
resolution remain owner actions.

**Supersedes.** none.