# PROGRESS — WickedBot

> ## ⚠️ READ THIS FILE FIRST — BEFORE TOUCHING THE SYSTEM
>
> **Owner instruction.** This file is the accumulated state of the project: what is built, what is only
> planned, what was tried and rejected, and which claims in the code and in older documents are already
> known to be wrong. Read it, then verify the specific claim you are about to rely on, in source.
>
> **Latest state (2026-10-05 17:32Z):** Both blockers are **cleared in the live editor** and
> `diagnose()` now reports **"No blocking problem found"** — no webhook, exactly one `pollTelegram_`
> trigger, `POLL_OFFSET` reset to `0`, channel reachable, bot is a channel admin. See **Item 17**.
> The root cause was a **webhook still armed** (409 blocks `getUpdates`) **plus zero polling
> triggers** — and `setupWebhook()` silently deletes the poll trigger, while the file's own header
> told you to deploy a web app and never to run `setupPolling`. A second latent trap was fixed at the
> same time: `setupPolling` used to preserve a stale `POLL_OFFSET` (`29357183`), and since Telegram
> assigns a *random* `update_id` after a week of quiet, that alone would have kept the bot silent with
> **no error logged**. The deployed file is **provably the new revision**: only the new code rewinds
> the offset, and it is now `0`. `node tests/run.js` → **119 assertions, 0 failed**.
> **Live E2E is still unproven** — the log sheet still shows `rows=4`, newest `2026-09-18T02:44:24Z`,
> so no update has yet been processed through polling. DM the bot `/start` and allow ~60 s; confirm by
> the log sheet growing past 4 rows or by `pollTelegram_` appearing in Executions.
>
> **Secrets: CLOSED (Item 18).** Both leaked Telegram tokens were verified **revoked** — each returns
> HTTP 401 against `getMe` — so the exposure is neutralised. The history purge had in fact **already
> been performed** by `git filter-repo` (26 commits rewritten; `.git/filter-repo/commit-map`), and
> local object-store plus working-tree scans are clean. The pre-rewrite commits remain retrievable
> from GitHub by SHA until it garbage-collects; that is **harmless now the credentials are dead**.
> Committed and pushed as `31d47be` (fast-forward, no force needed). Note that hashes quoted in
> sections 4–5 are **pre-rewrite** and no longer resolve locally — resolve them via the commit-map.
>
> Start with section 4 (progress), section 5 (drift), then section 6 (verification baseline). Docs
> note (2026-09-18): the legacy "orchestrator / worker role-play" framing was stripped from this file
> (preamble + worker-persona labels; technical facts, hashes and timestamps kept).

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
| CodeGraph | **Superseded 2026-09-26** by `code-review-graph`. The old index (`codegraph.json` + `.codegraph/`) was deleted; the replacement is `.code-review-graph/graph.db`, refreshed with `code_review_graph update` and queried with `query callers_of <fn>`. Note rule 5 still names the old tool — see section 5. |
| `diagnose()` | Read-only editor function: checks token, armed webhook, trigger count, channel id, `AUTO_REPLY`, channel reachability, bot admin status, log sheet. Run it first when the bot is silent. |
| regression suite | `tests/run.js` — runs the real `Code.gs` text against Apps Script stubs. Catches logic faults without a deployment; does not prove delivery. |
| `sender_chat`-not-`from` | Telegram quirk relevant to channel posts — see README. **Consequence (2026-10-05):** because *every* `channel_post` carries `sender_chat` = the channel and no `from`, the bot's own posts are indistinguishable from a user's by any field. The `message_id` from `sendMessage` is the only reliable signal. |
| `rememberBotMessage_` / `isOwnChannelMessage_` | CacheService (6 h) record of channel message ids the bot posted, so the listener never answers its own comment. Keyed by chat id + message id. |
| `autoReplyEnabled_` | The single reader of `AUTO_REPLY` (trim + lowercase, so `'TRUE'`/`' true '` mean on). Used by the listener *and* `cmdHelp` so they cannot disagree. |
| `diagnose()` | Editor-only, read-only. Checks token, armed webhook, trigger count, channel id, `AUTO_REPLY`, channel reachability, bot admin status and the log sheet; prints the first thing to fix. Sends nothing. |
| `own_post_ignored` / `channel_media_skipped` | Log-sheet actions for the two channel cases that used to be invisible: the bot's own echoed post, and a media/caption post (`msg.text` absent). |

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

### ✅ Item 16: Bot silent in the confession channel — self-reply loop + silent-failure audit (2026-10-05)

**What / why.** Owner report: "the bot is not functioning at all, it never replies to any chat in
confession." Nothing had run live since 2026-09-06, so this was diagnosed by executing the real
`Code.gs` against a stubbed Apps Script environment rather than by reading it. The harness was
adapted from the `limit tester` project (`tests/lib/gas-env.js` there), which runs the whole `.gs`
file against stubs and counts calls; WickedBot now has the equivalent under `tests/`.
**Changed.** New `tests/` suite (`run.js`, `lib/gas-env.js`, `test-channel.js`, `test-silence.js`,
`test-commands.js`, `test-diagnose.js`, `test-loop.js`). `Code.gs` fixes:
 1. **Self-reply loop (defect).** Telegram echoes a channel's posts back through `getUpdates`,
    *including posts the bot itself made*, and reports **every** `channel_post` with `sender_chat`
    set to the **channel** and no `from` at all — so the old guard
    `!(msg.from && msg.from.is_bot === true)` never fired and the bot answered its own comments.
    Fixed with `rememberBotMessage_`/`isOwnChannelMessage_` (ScriptCache, keyed by chat + the
    `message_id` that `sendMessage` returned), recorded from every channel-posting path
    (`/confess` x2, `/comment`, `/reply`, the listener). Skips are logged `own_post_ignored`.
 2. **`AUTO_REPLY` read strictly as `=== 'true'`.** `'True'`, `'TRUE'`, `' true '` all silently
    meant **off**, and `cmdHelp` read the flag separately from the listener, so the two could
    disagree. Both now go through `autoReplyEnabled_()` (trim + lowercase), and `/help` warns when
    auto-reply is on but no channel is set.
 3. **Media posts logged as `channel_ignored`.** A photo/video post carries `caption`, not `text`,
    so it was silently dropped under a misleading label; now `channel_media_skipped`.
 4. **New `diagnose()`** (editor-only, read-only): checks the token via `getMe`, a still-armed
    webhook (`getWebhookInfo` — the 409 that kills polling), the `pollTelegram_` trigger count, the
    numeric channel id, `AUTO_REPLY`, channel reachability, bot admin status via `getChatMember`,
    and the last rows of the log sheet; then prints the single first thing to fix.
**Decision(s).** D8 (single listener) reaffirmed — the own-message guard lives in that one place.
**Verified.** `node tests/run.js` → **114 assertions passed, 0 failed, across 5 files** (channel 25,
commands 29, diagnose 24, loop 6, silence 30). `node --check` on a `.js` temp copy: clean.
CodeGraph `update`: 1 file, 55 nodes, 601 edges. Every test runs the real `Code.gs` text.
**Not done / open.** Not run live — GAS still needs the re-paste and `diagnose()` run in the
owner's editor. The suite proves logic, not delivery: it cannot see the deployed copy, the real
token, or Telegram. Two failure modes remain by design and are documented, not fixed: a poisoned
`POLL_OFFSET` never rewinds, and a de-admined bot fails 403 with no alert.
**Supersedes.** Item 15's assumption that the code side was finished; section 6's "verified
2026-09-06" line now carries a "regression suite" row.

### ✅ Item 17: Root cause CONFIRMED from the live editor — webhook re-armed, no polling trigger (2026-10-05)

**What / why.** Owner ran `diagnose()` in the GAS editor (17:25:05Z). This is the first live evidence
since 2026-09-06 and it **replaces inference with fact** for the "bot is silent" report.
**Evidence (verbatim from the execution log).**
```
[OK]      TELEGRAM_BOT_TOKEN is set — length 46, ends ...bwFY
[OK]      Telegram accepts the token — @WickedAICofessionbot
[PROBLEM] A webhook is still registered — url=https://script.google.com/macros/s/AKfycbyYL3Wg.../exec
[INFO]    pending updates waiting — 3
[PROBLEM] No pollTelegram_ trigger exists — nothing calls the bot — this alone explains total silence
[INFO]    all project triggers — (none)
[OK]      POLL_OFFSET is set — 29357183
[OK]      Channel is reachable — UTHMConfession (channel)
[OK]      Bot is an admin in the channel — status=administrator
[OK]      Log sheet reachable — rows=4   (newest 2026-09-18T02:44:24Z, action=dispatch_help)
```
**Root cause.** Two independent blockers, either of which alone silences the bot:
 1. **A webhook is armed** at the hardcoded `WEBHOOK_URL_` (`AKfycbyYL3Wg.../exec`) — the dead path
    from D5. Telegram refuses `getUpdates` while a webhook is set (409), so polling could receive
    nothing even if it ran. `setupWebhook()` deletes the poll trigger (line 125), so running it also
    removes the trigger — which is exactly the observed state: webhook armed **and** zero triggers.
 2. **No `pollTelegram_` trigger exists.** Nothing calls the bot at all.
**Why it went unnoticed for a month.** `setupWebhook()` silently deletes the polling trigger and
arms the webhook, and the file header's own setup steps said *"Deploy → New deployment → Web app →
Anyone"* — instructions for the **dead webhook path** that never mentioned `setupPolling`. Following
the file's own instructions produced exactly this silent state. Last real activity in the log sheet is
2026-09-18, consistent with the webhook era ending there.
**Changed (Code.gs, uncommitted).**
 1. **`setupPolling()` now resets `POLL_OFFSET` to `0` unconditionally** (was: only if unset). This is
    a **second latent trap** found from the live data: the stored offset was `29357183` — a September
    value from the webhook era — and Telegram assigns a **random** `update_id` after a week of no
    updates. Since `getUpdates` returns only `update_id >= offset`, the old code would have left the
    bot polling forever, receiving an empty list, logging **no error**: total silence that looks
    identical to a dead trigger. `deleteWebhook()` runs first and drops the pending queue, so
    rewinding cannot replay old updates.
 2. `deleteWebhook()` now parses the response and **returns/report success honestly** (it previously
    logged and ignored the result, on which `setupPolling`'s rewind depends).
 3. `pollTelegram_` now **spells out 409 and 401** instead of printing a bare status code — 409 is
    the single likeliest cause of total silence and the status code alone does not say so.
 4. **File header setup steps rewritten**: they now say to make the bot a channel admin and to run
    `setupPolling`, and carry an explicit "do not deploy a web app or run `setupWebhook`" warning.
**Decision(s).** D5 reaffirmed (polling is the only live ingress). D8 unaffected.
**Verified.** `node --check` clean; `node tests/run.js` → **119 assertions passed, 0 failed** (5
files; channel 30, commands 29, diagnose 24, loop 6, silence 30), including two new tests that fail
against the old `setupPolling` (stale offset → silence; reset → delivery restored). CodeGraph
`update`: 55 nodes, 607 edges. `diagnose()` correctly identified both blockers from live state.
**Fix applied by the owner in the editor (2026-10-05 17:32:24Z) — first clean `diagnose`.**
```
[OK] No webhook registered — polling can receive updates
[OK] Exactly one pollTelegram_ trigger — the bot is being called once a minute
[INFO] all project triggers — pollTelegram_
[OK] POLL_OFFSET is set — 0
[OK] Channel is reachable — UTHMConfession (channel)
[OK] Bot is an admin in the channel — status=administrator
==> No blocking problem found.
```
Both blockers cleared and the offset is `0`. The `pending updates waiting — 3` line is gone, i.e.
`drop_pending_updates` discarded the stale September queue as intended.
**The deployed file is provably the new revision.** The offset was `29357183` and is now `0`; the
**old** `setupPolling` reset the offset only when unset, so it would have left `29357183` in place.
Only the new code rewinds it — so the re-paste took, confirmed by behaviour rather than by assumption.
**Not done / open.** **Live E2E still unproven**: the log sheet still shows `rows=4` with the newest
entry `2026-09-18T02:44:24Z`, so no update has been processed through polling yet. Owner must DM the
bot `/start` and allow up to ~60 s (the poll interval). Confirm by either the log sheet growing past
4 rows, or Executions showing `pollTelegram_` runs. The 3 pending updates were queued before
`deleteWebhook` dropped them.
**Supersedes.** Item 16's inference — the self-reply loop it fixed was real, but it was **not** the
cause of this silence; Item 16's own evidence showed the loop never starved genuine posts. Section 6's
"verified 2026-09-06" line is now known to have covered a webhook-era state.

### ✅ Item 18: Secret exposure closed — rotation VERIFIED, history already purged (2026-10-05)

**What / why.** Owner instruction: "rotate the secret in git history, make sure no secret within and
commit and push". Rotation and purging are different jobs (D10) and were checked separately.
**Verified — rotation (the part that actually matters).** Both token-shaped strings from the old
public revisions were extracted and tested against `getMe`. **Both returned HTTP 401 Unauthorized**,
i.e. both credentials are **revoked and dead**:
```
bot id 8972406236 -> HTTP 401 (revoked)
bot id 8945572488 -> HTTP 401 (revoked)
```
No Gemini-key-shaped string (`AIza…`) appears in any revision — that key was pasted into chat, never
committed, and is unaffected by this work. The exposed values were never printed or re-recorded here
(rule 10).
**Discovered — the history purge had ALREADY been done.** `.git/filter-repo/` contains `commit-map`,
`ref-map` and `changed-refs` from a completed `git filter-repo` run: 26 commits rewritten, all
`refs/heads/master`. The rewritten tip `ac2c036` **is** what GitHub serves. So:
 - **Local history is clean.** A full scan of all 53 blobs in the object store for
   `[0-9]{8,12}:[A-Za-z0-9_-]{30,}` and `AIza[0-9A-Za-z_-]{30,}` returned **0 hits**; the working tree
   (32 files, incl. untracked) also returned **0 hits**.
 - **The old commits remain retrievable from GitHub by SHA** (they are dangling, not GC'd). Confirmed
   by fetching `PROGRESS.md` at `09ff5a8`, `64cefc7`, `7bfaffc`, `543618d`, `b6ba428`, `395f6c4`,
   `72876b4` — all still served. This is now **harmless**: the credentials in them are revoked. It
   stays true until GitHub garbage-collects, and a force-push does not accelerate that.
 - **No forks, 0 stars, 0 watchers** — no third-party copy of the pre-rewrite history is known.
**Consequence for this file.** The commit hashes quoted throughout sections 4 and 5 are
**pre-rewrite** and no longer resolve locally (e.g. `f4a2068` → `960fbd5`, `ee7628f` → `f363c9a`,
`09ff5a8` → `da3eea0`, `395f6c4` → `320f6ec`). They are kept as historical record; the full
old→new map is `.git/filter-repo/commit-map`. Do not `git rm` under `.git/filter-repo/`.
**Decision(s).** D10 — confirmed correct and now satisfied: revocation was the fix, redaction/purging
was hygiene. The exposure window was 2026-09-02/03 → 2026-10-05.
**Committed and pushed (owner-approved).** `31d47be` on `master`, fast-forward from `ac2c036` (no
force-push needed — the rewritten line was already what the remote served). 28 files, +2298/-57:
`Code.gs` (Items 16–17), `PROGRESS.md`, `README.md`, the new `tests/` suite, and the code-review-graph
config that was previously untracked. Pre-push checks: `node --check` clean, **119 assertions / 0
failed**, secret scan of `HEAD` clean, and the pushed revision re-scanned over the network (0
secret-shaped matches in `PROGRESS.md`, `Code.gs`, `README.md`, `AGENTS.md`, `tests/lib/gas-env.js`).
No CI workflows exist, so the push triggered no deploy.
**Correction to an earlier claim in this session.** The "hooks silently no-op" note was **too broad**.
The **git** `pre-commit` hook works — Git for Windows runs hooks under its own bundled `sh.exe`
(`C:\Program Files\Git\usr\bin\sh.exe`), which sees `code-review-graph` — and it fired during this
commit (`Incremental: 7 files updated, 82 nodes, 772 edges`). Only the **AI-tool** hooks
(`.claude/settings.json`, `.gemini/hooks/*.sh`) are broken, because PATH `bash` is the WSL relay with
no distro and `python3` is absent. Section 5's drift row has been corrected to say exactly that.
**Not done / open.** Removing the dangling pre-rewrite commits from GitHub entirely needs either a
GitHub Support request or deleting and recreating the repo — owner's call, and **not urgent now that
the tokens are dead**. Also noted: `.codebuddy/`, `.gemini/`, `.kiro/`, `.qoder/` were deleted from
disk during this session (outside it) — they were untracked, so no git impact.
**Supersedes.** Section 5's "open security issue" row for the leaked tokens.

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
| PROGRESS.md on 2026-09-02/03 | Raw Telegram bot tokens could be recorded in this file | Two raw tokens entered the **pushed** git history; redaction does not rewrite history | **CLOSED 2026-10-05** — both tokens verified revoked (HTTP 401 against `getMe`); history was already purged by `git filter-repo`; local object store scans clean. See Item 18. |
| Sections 4–5 commit hashes (quoted throughout) | The hashes name the current commits | A `git filter-repo` rewrite (recorded in `.git/filter-repo/commit-map`) changed every hash; the quoted ones are **pre-rewrite** and no longer resolve locally (`f4a2068` → `960fbd5`, `ee7628f` → `f363c9a`, `09ff5a8` → `da3eea0`, `395f6c4` → `320f6ec`) | **known, kept deliberately** as historical record — use the commit-map to resolve |
| Old commits still retrievable on GitHub by SHA | "The history is purged" | Dangling pre-rewrite commits (`09ff5a8`, `64cefc7`, `7bfaffc`, `543618d`, `b6ba428`, `395f6c4`, `72876b4`) are **still served** by GitHub until it GCs them; a force-push does not remove them | **harmless but open** — the credentials inside are revoked; full removal needs GitHub Support or repo recreation (Item 18) |
| 2026-09-15 items | "all ten findings closed" while deployed editor copy was still stale | Repo is fixed; the **deployed** `Code.gs` may still be a truncated/stale paste | **drift** — re-paste verified against HEAD before debugging live bugs |
| Item 10 / section 6 (2026-09-06) | Channel auto-reply worked | It replied to **its own comments**: Telegram echoes a channel's posts back through `getUpdates`, and every `channel_post` carries `sender_chat` = the channel with no `from`, so the old `is_bot` guard never matched | **superseded 2026-10-05** by Item 16 — fixed with own-message tracking |
| README / PROGRESS before 2026-10-05 | `AUTO_REPLY` must be exactly `true` | Correct, but `'True'`/`'TRUE'`/`' true '` silently meant **off**, with no warning anywhere | **superseded 2026-10-05** — `autoReplyEnabled_()` now trims and lowercases |
| Rule 5 + glossary (before 2026-10-05) | "Initialise CodeGraph … use it before grep" | `codegraph.json` and `.codegraph/` were **deleted** on 2026-09-26 and replaced by `code-review-graph` (`.code-review-graph/graph.db`). Rule 5 names a tool that no longer exists here | **drift** — rule 5 needs rewording by the owner (it is an owner instruction, not a finding) |
| `AGENTS.md` / `CLAUDE.md` etc. (2026-09-26) | "Start with the code-review-graph MCP tools" | Those MCP tools are **not available in this harness**: `code-review-graph install` supports 17 platforms and **DSH is not one of them**, and the DSH profile has no `@deepseek-ai/dsh-mcp-client` entry, so the server is never launched. The `.mcp.json` / `AGENTS.md` files it wrote are Claude/Cursor-shaped and DSH does not read them | **drift** — the graph is still usable via the `code_review_graph` CLI; wiring the MCP server into `cordis.patch.yml` is an owner decision |
| `.claude/settings.json`, `.gemini/hooks/*.sh` (2026-09-26) | "The graph auto-updates on file changes (via hooks)" | **Partly true, and the distinction matters.** The **git** `pre-commit` hook *does* work: Git for Windows runs hooks under its own bundled `sh.exe` (`C:\Program Files\Git\usr\bin\sh.exe`), which can see `code-review-graph`, so the graph refreshes on every commit — observed working 2026-10-05 (`Incremental: 7 files updated, 82 nodes, 772 edges` during commit `1c8f64c`). The **AI-tool** hooks are the broken ones: `.claude/settings.json` and `.gemini/hooks/*.sh` are POSIX shell that call `cat >/dev/null`, `command -v` and `python3`, and on this host PATH `bash` is the WSL relay with no distro (`execvpe(/bin/bash) failed`) and `python3` is absent — so those never fire | **drift** — graph freshness is guaranteed at commit time, not on edit; run `code_review_graph update` by hand for mid-session queries |
| `setupWebhook` still present in `Code.gs` | The code may look like webhook is live | Reference only; ingress is polling; `stopPolling()` no longer re-arms it | **known dead path** — do not re-enable without re-opening D5 |

## 6. Verification baseline

| Check | Command | Last result | Date |
| ----- | ------- | ----------- | ---- |
| Syntax check | copy `Code.gs` → `.js`, `node --check` | clean | 2026-10-05 |
| Regression suite | `node tests/run.js` | **119 passed, 0 failed** (5 files) | 2026-10-05 |
| CodeGraph index | `code_review_graph update` | 55 nodes, 607 edges (1 file) | 2026-10-05 |
| Live diagnosis | `diagnose()` in the GAS editor | ✅ 2026-10-05 17:25Z found both blockers; **17:32Z clean — "No blocking problem found"** | 2026-10-05 |
| Live polling E2E | DM `/start`, `/help`, `/comment`, `/confess`; channel post → threaded reply | ⏳ **unproven** — log sheet still `rows=4`, newest 2026-09-18T02:44:24Z | — |
| Live webhook deploy | — | N/A — webhook path abandoned (D5); a stray armed webhook is what broke it | — |
| Secret scan | `git grep -E "AIza[0-9A-Za-z_-]{20,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}"` | 0 hits in `HEAD`; pushed revision re-scanned over the network: 0 | 2026-10-05 |
| Leaked-token rotation | `getMe` against each old token | **both HTTP 401 — revoked** | 2026-10-05 |
| Git state | `git status` / `git log --oneline -5` | clean; HEAD `31d47be` pushed, 0 ahead / 0 behind | 2026-10-05 |

The regression suite executes the **real text of `Code.gs`** against stubs for PropertiesService,
CacheService, UrlFetchApp, SpreadsheetApp, ScriptContent, ContentService and ScriptApp. It catches
reference errors, wrong argument shapes, and logic faults — including the self-reply loop, which no
amount of reading had found. It does **not** prove delivery: it cannot see the deployed editor copy,
the real token, or Telegram's actual behaviour. Green here means "the logic is right", not "the bot
replied".

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