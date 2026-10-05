// Walks the "why is the bot silent?" decision tree against the real Code.gs.
//
//   node tests/test-silence.js
//
// Every branch here is a way for the channel to go quiet WITHOUT an exception, so
// nothing shows up in the Executions log as a failure. The point is to separate
// "the code refuses to reply" from "the code never got the update at all".

"use strict";

const { buildEnv, privateMsg, channelPost } = require("./lib/gas-env");

const CH = "-1001957164507";
const ME = 1790450430;

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (detail ? "\n         " + detail : ""));
  }
}
/** Record a finding that is informational rather than pass/fail. */
function note(text) {
  console.log("  NOTE " + text);
}

console.log("\n=== A. Is the update even REACHING the handler? ===");

{
  // The webhook left armed is the classic total-kill: getUpdates answers 409 forever.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(
    409,
    '{"ok":false,"error_code":409,"description":"Conflict: can\'t use getUpdates method while webhook is active"}',
  );
  env.queueUpdates([channelPost("hello", CH, 9001)]);
  env.ctx.pollTelegram_();
  ok("webhook armed -> 409 -> bot is silent", env.sentTo(CH).length === 0);
  note("the code only console.errors the 409; it never calls deleteWebhook to heal itself");
}

{
  // Revoked / rotated token: every Telegram call 401s.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(401, '{"ok":false,"error_code":401,"description":"Unauthorized"}');
  env.ctx.pollTelegram_();
  ok("revoked token -> 401 -> bot is silent", env.sentTo(CH).length === 0);
  note("this is exactly what a BotFather /revoke looks like if the script property was not updated");
}

{
  // ok:false with HTTP 200 (Telegram does this for some errors).
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(200, '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}');
  env.ctx.pollTelegram_();
  ok("ok:false on HTTP 200 -> silent, no throw", env.sentTo(CH).length === 0);
}

console.log("\n=== B. A poisoned POLL_OFFSET is unrecoverable ===");
{
  // If the stored offset ever lands ABOVE the real update ids, Telegram returns an
  // empty list forever and nothing in the logs says anything is wrong.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true", POLL_OFFSET: "999999999" } });
  env.queueUpdates([channelPost("this will never be seen", CH, 9002)]);
  env.ctx.pollTelegram_();
  ok("offset above the real ids -> silent", env.sentTo(CH).length === 0);
  ok("...and NOTHING is logged as an error", env.errors.length === 0, JSON.stringify(env.errors));
  ok("...and the offset never comes back down", env.props.POLL_OFFSET === "999999999", "POLL_OFFSET=" + env.props.POLL_OFFSET);
  note("POLL_OFFSET only ever moves forward; there is no reset path except setupPolling()");
}

console.log("\n=== C. Does the post SHAPE match what the handler requires? ===");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("plain text post", CH).channel_post);
  ok("plain-text channel post -> replied", env.sentTo(CH).length === 1);
}
{
  // A photo/video post carries `caption`, NOT `text`. The guard is `msg.text && ...`,
  // so every media post is dropped on the floor with no log line at all.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  const chat = { id: Number(CH), type: "channel", title: "Confessions" };
  env.ctx.handleMessage({
    message_id: 20,
    sender_chat: chat,
    chat,
    date: 1700000000,
    caption: "my confession, as a photo",
    photo: [{ file_id: "x" }],
  });
  ok("media/caption post is DROPPED (msg.text is undefined)", env.sentTo(CH).length === 0);
  ok(
    "...and it is logged as channel_media_skipped, not lumped in with ignored posts",
    env.sheetRows.length === 1 && env.sheetRows[0][8] === "channel_media_skipped",
    JSON.stringify(env.sheetRows.map((r) => r[8])),
  );
  note("if the channel posts images or media-with-caption, the bot is silent for all of them");
}
{
  // A channel post whose text starts with '/' is skipped.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("/somecommand", CH).channel_post);
  ok("channel post starting with '/' -> skipped", env.sentTo(CH).length === 0);
}
{
  // Forwarded post: text is present but the post is a forward.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  const chat = { id: Number(CH), type: "channel", title: "Confessions" };
  env.ctx.handleMessage({
    message_id: 21,
    sender_chat: chat,
    chat,
    date: 1700000000,
    text: "forwarded confession",
    forward_origin: { type: "user", sender_user: { id: 5 } },
  });
  ok("forwarded post with text IS replied to", env.sentTo(CH).length === 1, JSON.stringify(env.chatsSent()));
}

console.log("\n=== D. Config-level silence ===");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } }); // AUTO_REPLY absent
  env.ctx.handleMessage(channelPost("no auto reply", CH).channel_post);
  ok("AUTO_REPLY unset -> silent (documented default)", env.sentTo(CH).length === 0);
  note("PROGRESS.md Item 15 lists 'set AUTO_REPLY=true' as REMAINING WORK, so this may never have been done");
}
{
  // FIXED: the flag is read through autoReplyEnabled_(), which trims and lowercases,
  // so a stray capital or space no longer silently disables the listener.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "TRUE" } });
  env.ctx.handleMessage(channelPost("case sensitivity", CH).channel_post);
  ok("AUTO_REPLY='TRUE' now counts as ON", env.sentTo(CH).length === 1, JSON.stringify(env.chatsSent()));
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: " true " } });
  env.ctx.handleMessage(channelPost("whitespace", CH).channel_post);
  ok("AUTO_REPLY=' true ' now counts as ON", env.sentTo(CH).length === 1, JSON.stringify(env.chatsSent()));
}
{
  // Still off for genuinely false-y values.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "1" } });
  env.ctx.handleMessage(channelPost("numeric one", CH).channel_post);
  ok("AUTO_REPLY='1' is still OFF (not a synonym for true)", env.sentTo(CH).length === 0);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "false" } });
  env.ctx.handleMessage(channelPost("explicit false", CH).channel_post);
  ok("AUTO_REPLY='false' is OFF", env.sentTo(CH).length === 0);
}
{
  const env = buildEnv({ props: { AUTO_REPLY: "true" } }); // no channel id at all
  env.ctx.handleMessage(channelPost("no channel configured", CH).channel_post);
  ok("no CONFESSION_CHANNEL_ID -> silent", env.sentTo(CH).length === 0);
  note("/help still claims auto-reply is ON in this state, because it only reads AUTO_REPLY");
}

console.log("\n=== E. Does the bot's own output come back around? ===");
{
  // Telegram delivers a channel's posts back to an admin bot, INCLUDING the bot's own.
  // `sender_chat` is the CHANNEL for every channel post, so no field distinguishes them.
  // The ONLY reliable signal is the message_id that sendMessage returned.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });

  // 1. The bot posts a comment; its message_id becomes known.
  env.ctx.handleMessage(channelPost("a real user confession", CH, 5000, 40).channel_post);
  ok("user post is answered", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));

  // 2. Telegram echoes the bot's own comment back as a channel_post.
  env.reset();
  env.ctx.handleMessage(channelPost("<b>Comment:</b>\n\nNice one.", CH, 5001, 501).channel_post);
  ok(
    "bot's OWN comment is NOT re-answered (loop closed)",
    env.sentTo(CH).length === 0,
    "REPLIED TO ITSELF -> " + JSON.stringify(env.telegram.map((t) => t.payload.text)),
  );
  ok(
    "...and it is logged as own_post_ignored",
    env.sheetRows.some((r) => r[8] === "own_post_ignored"),
    JSON.stringify(env.sheetRows.map((r) => r[8])),
  );

  // 3. A DIFFERENT message_id is still answered — the guard must not over-block.
  env.reset();
  env.ctx.handleMessage(channelPost("a second real user post", CH, 5002, 777).channel_post);
  ok("a genuinely new post is still answered", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));
}

console.log("\n=== F. Rate limiter as a silence source ===");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  let replied = 0;
  for (let i = 0; i < 20; i++) {
    env.reset();
    env.ctx.handleMessage(channelPost("post number " + i, CH, 1000 + i, 100 + i).channel_post);
    if (env.sentTo(CH).length) replied++;
  }
  ok("hard cap is 15 channel replies per minute", replied === 15, "replied=" + replied);
  note("the 16th..20th posts in the same minute get NOTHING and are not logged as muted");
}

console.log("\n=== G. Permission failures look like success ===");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, send: "forbidden" });
  env.ctx.handleMessage(channelPost("bot is not an admin", CH).channel_post);
  ok("sendMessage 403 still attempts a send", env.sentTo(CH).length === 1);
  ok("...and the 403 IS logged", env.errors.some((e) => /403/.test(e)), JSON.stringify(env.errors));
  note("nothing retries, alerts, or disables auto-reply, so a de-admined bot is silent forever");
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, send: "noRights" });
  env.ctx.handleMessage(privateMsg("/confess hello", ME).message);
  const sent = env.sentTo(ME);
  ok(
    "/confess reports the failure to the user",
    sent.length >= 1 && /Could not post/.test(sent[sent.length - 1].payload.text),
    JSON.stringify(sent.map((s) => s.payload.text)),
  );
}
{
  // The channel auto-reply path has NO such reporting — it is fire-and-forget.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, send: "forbidden" });
  env.ctx.handleMessage(channelPost("silent failure", CH).channel_post);
  ok(
    "channel auto-reply failure is invisible to the owner (no DM, no sheet row)",
    !env.sheetRows.some((r) => r[8] && /error|fail/i.test(String(r[8]))),
    JSON.stringify(env.sheetRows.map((r) => r[8])),
  );
}

console.log("\n=== H. The poll never even runs (deployment-level) ===");
{
  // If setupPolling was never run, there is no trigger. Nothing in the file can detect
  // this from inside; it is only visible as "the bot does nothing at all".
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  ok("no trigger exists until setupPolling() is run", env.triggers.length === 0);
  env.ctx.setupPolling();
  ok("after setupPolling() exactly one trigger exists", env.triggers.length === 1);
}
{
  // stopPolling must not re-arm the webhook (regression from Item 12 finding 3).
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.setupPolling();
  env.ctx.stopPolling();
  ok("stopPolling leaves zero triggers", env.triggers.length === 0);
  ok(
    "stopPolling does NOT call setupWebhook",
    !env.urlCalls.some((c) => c.kind === "setWebhook"),
    JSON.stringify(env.urlCalls.map((c) => c.kind)),
  );
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
