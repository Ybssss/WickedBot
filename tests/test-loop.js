// The real-world sequence, end to end through pollTelegram_.
//
//   node tests/test-loop.js
//
// Telegram echoes a channel's posts back through getUpdates — including posts the BOT
// made. So: user posts -> bot comments -> that comment arrives as a new update -> the
// bot comments on its own comment -> forever. This file drives the actual polling loop
// and counts how many comments one user post produces.

"use strict";

const { buildEnv, channelPost } = require("./lib/gas-env");

const CH = "-1001957164507";
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

console.log("\n--- one user post, fed back through polling ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });

  // Poll 1: the user's post arrives.
  env.queueUpdates([channelPost("I failed my exam", CH, 100, 40)]);
  env.ctx.pollTelegram_();
  const afterFirst = env.sentTo(CH).length;
  ok("the user post gets exactly one comment", afterFirst === 1, "comments=" + afterFirst);

  // What message_id did the bot's comment get? (stub hands out 501 first.)
  const botCommentId = 501;

  // Poll 2: Telegram echoes the bot's OWN comment back as a channel_post.
  env.queueUpdates([channelPost("<b>Comment:</b>\n\nNice one.", CH, 101, botCommentId)]);
  env.ctx.pollTelegram_();
  ok(
    "the echoed own-comment produces NO further comment",
    env.sentTo(CH).length === afterFirst,
    "comments=" + env.sentTo(CH).length + " (loop!)",
  );

  // Poll 3..6: the loop is broken because the bot posted NOTHING new, so no new
  // message_id exists for Telegram to echo. Re-delivering 501 proves the skip is
  // idempotent (a retried/duplicated update must not sneak past).
  for (let i = 0; i < 4; i++) {
    env.queueUpdates([channelPost("<b>Comment:</b>\n\nNice one.", CH, 102 + i, botCommentId)]);
    env.ctx.pollTelegram_();
  }
  ok(
    "re-delivering the same own-comment never restarts the loop",
    env.sentTo(CH).length === afterFirst,
    "comments=" + env.sentTo(CH).length,
  );
  ok(
    "...because the bot created no new message to echo",
    env.sentTo(CH).length === 1,
    "bot messages=" + env.sentTo(CH).length,
  );
}

console.log("\n--- the loop is bounded by the quota, not by the code (pre-fix behaviour) ---");
{
  // Demonstrates WHY this matters: without own-message tracking, each echo is answered.
  // We simulate the pre-fix condition by posting with message ids the bot never recorded.
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  let comments = 0;
  for (let i = 0; i < 20; i++) {
    env.queueUpdates([channelPost("echo " + i, CH, 200 + i, 900 + i)]);
    env.ctx.pollTelegram_();
  }
  comments = env.sentTo(CH).length;
  ok(
    "unrecorded posts are still answered (the guard does not over-block)",
    comments === 15,
    "comments=" + comments,
  );
  console.log("         (15 = CHANNEL_REPLY_MIN_HARD_, i.e. the per-minute ceiling is the only brake)");
}

console.log("\n--- a genuine user post still gets through after the guard ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.queueUpdates([channelPost("first real post", CH, 300, 40)]);
  env.ctx.pollTelegram_();
  const n1 = env.sentTo(CH).length;

  env.queueUpdates([channelPost("<b>Comment:</b>\n\nNice one.", CH, 301, 501)]);
  env.ctx.pollTelegram_();

  env.queueUpdates([channelPost("second real post", CH, 302, 41)]);
  env.ctx.pollTelegram_();
  ok("a later real post is still answered", env.sentTo(CH).length === n1 + 1, "comments=" + env.sentTo(CH).length);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
