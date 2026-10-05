// Exercises the real "Code.gs" against the stubs in lib/gas-env.js.
//
//   node tests/test-channel.js
//
// The question this file answers: why does the bot never reply in the confession channel?

"use strict";

const { buildEnv, privateMsg, channelPost, channelPostFromBot } = require("./lib/gas-env");

const CH = "-1001957164507";
const ME = 1790450430;
const BOT = 8945572488;

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

console.log("\n--- 1. private chat still works? ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.handleMessage(privateMsg("/start", ME).message);
  ok("private /start gets a reply", env.sentTo(ME).length === 1, JSON.stringify(env.chatsSent()));
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.handleMessage(privateMsg("/help", ME).message);
  ok("private /help gets a reply", env.sentTo(ME).length === 1, JSON.stringify(env.chatsSent()));
}

console.log("\n--- 2. channel post, AUTO_REPLY=true (the intended config) ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("I failed my exam", CH).channel_post);
  const sent = env.sentTo(CH);
  ok("channel post gets a comment", sent.length === 1, JSON.stringify(env.telegram));
  ok(
    "comment is threaded under the post",
    sent.length === 1 && sent[0].payload.reply_to_message_id === 10,
    JSON.stringify(sent[0] && sent[0].payload),
  );
  ok("Gemini was actually called", env.geminiCalls() === 1, "geminiCalls=" + env.geminiCalls());
}

console.log("\n--- 3. channel post, AUTO_REPLY unset (the DEFAULT) ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.handleMessage(channelPost("I failed my exam", CH).channel_post);
  ok(
    "AUTO_REPLY unset -> channel is SILENT (by design, D8)",
    env.sentTo(CH).length === 0,
    JSON.stringify(env.telegram),
  );
  ok("...and Gemini was never called", env.geminiCalls() === 0, "geminiCalls=" + env.geminiCalls());
  ok(
    "the log records channel_ignored",
    env.sheetRows.some((r) => r[8] === "channel_ignored"),
    JSON.stringify(env.sheetRows.map((r) => r[8])),
  );
}

console.log("\n--- 4. polling delivers channel posts at all? ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.queueUpdates([channelPost("via polling", CH, 7001)]);
  env.ctx.pollTelegram_();
  ok("pollTelegram_ dispatches channel_post", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));
  ok("POLL_OFFSET advanced past it", env.props.POLL_OFFSET === "7002", "POLL_OFFSET=" + env.props.POLL_OFFSET);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.queueUpdates([privateMsg("/start", ME, 8001)]);
  env.ctx.pollTelegram_();
  ok("pollTelegram_ dispatches private messages", env.sentTo(ME).length === 1, JSON.stringify(env.telegram));
}

console.log("\n--- 5. the bot's own channel posts (loop risk) ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  // Post as a user: the bot replies, and its reply's message_id is now known.
  env.ctx.handleMessage(channelPost("user post", CH, 500, 40).channel_post);
  const firstReply = env.sentTo(CH);
  ok("user post is answered", firstReply.length === 1, JSON.stringify(env.telegram));

  const botMessageId = 501; // what the stubbed sendMessage returned
  env.reset();
  // Now Telegram echoes that very reply back as a channel_post.
  env.ctx.handleMessage(channelPostFromBot("<b>Comment:</b>\n\nNice one.", CH, 501, botMessageId).channel_post);
  ok(
    "bot does NOT reply to its own channel post",
    env.sentTo(CH).length === 0,
    "REPLIED TO ITSELF -> " + JSON.stringify(env.telegram),
  );
  ok(
    "...and the skip is logged as own_post_ignored",
    env.sheetRows.some((r) => r[8] === "own_post_ignored"),
    JSON.stringify(env.sheetRows.map((r) => r[8])),
  );
}

console.log("\n--- 6. total-failure modes ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(409, '{"ok":false,"error_code":409,"description":"Conflict: can\'t use getUpdates method while webhook is active"}');
  let threw = null;
  try {
    env.ctx.pollTelegram_();
  } catch (e) {
    threw = e;
  }
  ok("409 webhook conflict does not crash the trigger", threw === null, threw ? String(threw) : "");
  ok(
    "...but it is only logged, never healed",
    env.errors.some((e) => /409/.test(e)),
    JSON.stringify(env.errors),
  );
}
{
  // Token missing entirely: getConfig() throws BEFORE the try/catch in pollTelegram_.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true", TELEGRAM_BOT_TOKEN: "" } });
  delete env.props.TELEGRAM_BOT_TOKEN;
  let threw = null;
  try {
    env.ctx.pollTelegram_();
  } catch (e) {
    threw = e;
  }
  ok(
    "missing token throws out of pollTelegram_ (trigger dies silently)",
    threw !== null,
    threw ? "threw: " + threw.message : "no throw",
  );
}
{
  // @channelname instead of a numeric id: getConfig() nulls it out.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: "@myconfessions", AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("hello", CH).channel_post);
  ok(
    "non-numeric CONFESSION_CHANNEL_ID -> channel is null -> SILENT",
    env.sentTo(CH).length === 0,
    JSON.stringify(env.telegram),
  );
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: "@myconfessions" } });
  env.ctx.handleMessage(privateMsg("/confess hello", ME).message);
  const sent = env.sentTo(ME);
  ok(
    "/confess says 'No channel configured' when the id is non-numeric",
    sent.length === 1 && /No channel configured/.test(sent[0].payload.text),
    JSON.stringify(sent.map((s) => s.payload.text)),
  );
}

console.log("\n--- 7. channel id matching ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("wrong channel", "-1009999999999").channel_post);
  ok("post in a DIFFERENT channel is ignored", env.sentTo("-1009999999999").length === 0, JSON.stringify(env.chatsSent()));
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: " " + CH + " ", AUTO_REPLY: "true" } });
  env.ctx.handleMessage(channelPost("padded id", CH).channel_post);
  ok("padded channel id still matches", env.sentTo(CH).length === 1, JSON.stringify(env.chatsSent()));
}

console.log("\n--- 8. Gemini down does not silence the bot ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, gemini: "error" });
  env.ctx.handleMessage(channelPost("gemini is down", CH).channel_post);
  ok("Gemini 500 still produces a fallback comment", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, gemini: "empty" });
  env.ctx.handleMessage(channelPost("gemini is empty", CH).channel_post);
  ok("Gemini empty still produces a fallback comment", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));
}

console.log("\n--- 9. setupPolling arms the trigger ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.setupPolling();
  ok(
    "setupPolling creates exactly one pollTelegram_ trigger",
    env.triggers.filter((t) => t.getHandlerFunction() === "pollTelegram_").length === 1,
    JSON.stringify(env.triggers.map((t) => t.getHandlerFunction())),
  );
  ok("setupPolling deletes the webhook", env.urlCalls.some((c) => c.kind === "deleteWebhook"), JSON.stringify(env.urlCalls.map((c) => c.kind)));
}

console.log("\n--- 10. setupPolling resets a stale POLL_OFFSET ---");
{
  // Telegram assigns a RANDOM update_id after a week of no updates, so a stored offset can
  // end up above every future update. getUpdates only returns update_id >= offset, so the
  // bot polls forever, gets an empty list, and logs NO error. This is the trap that would
  // have kept the channel silent even after the webhook was removed.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true", POLL_OFFSET: "999999999" } });
  env.ctx.setupPolling();
  ok("setupPolling resets the offset to 0", env.props.POLL_OFFSET === "0", "POLL_OFFSET=" + env.props.POLL_OFFSET);

  // And the reset actually restores delivery.
  env.queueUpdates([channelPost("after the reset", CH, 5)]);
  env.ctx.pollTelegram_();
  ok("a post is delivered again after the reset", env.sentTo(CH).length === 1, JSON.stringify(env.telegram));
}
{
  // Re-running setupPolling must not be destructive: it is the documented recovery step.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.ctx.setupPolling();
  env.ctx.setupPolling();
  ok(
    "re-running setupPolling leaves exactly one trigger",
    env.triggers.filter((t) => t.getHandlerFunction() === "pollTelegram_").length === 1,
    JSON.stringify(env.triggers.map((t) => t.getHandlerFunction())),
  );
}

console.log("\n--- 11. a still-armed webhook is reported as such ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(
    409,
    '{"ok":false,"error_code":409,"description":"Conflict: can\'t use getUpdates method while webhook is active"}',
  );
  env.ctx.pollTelegram_();
  ok(
    "the 409 log line names the cause and the fix",
    env.errors.some((e) => /409 CONFLICT/.test(e) && /setupPolling/.test(e)),
    JSON.stringify(env.errors),
  );
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.failGetUpdates(401, '{"ok":false,"error_code":401,"description":"Unauthorized"}');
  env.ctx.pollTelegram_();
  ok(
    "the 401 log line names the token",
    env.errors.some((e) => /401 UNAUTHORIZED/.test(e) && /TELEGRAM_BOT_TOKEN/.test(e)),
    JSON.stringify(env.errors),
  );
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
