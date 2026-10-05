// Smoke test: every private command still works after the channel fixes.
//
//   node tests/test-commands.js

"use strict";

const { buildEnv, privateMsg } = require("./lib/gas-env");

const CH = "-1001957164507";
const ME = 1790450430;
const OTHER = 555000111;

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

function run(text, props, userId) {
  const env = buildEnv({ props: Object.assign({ CONFESSION_CHANNEL_ID: CH }, props || {}) });
  env.ctx.handleMessage(privateMsg(text, userId || ME).message);
  return env;
}

console.log("\n--- every command answers in a DM ---");
for (const cmd of ["/start", "/help", "/comment hello", "/roast hello", "/confess hello", "/reply 5", "/setchannel"]) {
  const env = run(cmd, { ADMIN_IDS: String(ME) });
  ok(cmd + " -> DM reply", env.sentTo(ME).length >= 1, JSON.stringify(env.chatsSent()));
}

console.log("\n--- usage errors ---");
{
  const env = run("/comment", {});
  ok("/comment with no args asks for a topic", /What topic/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/confess", {});
  ok("/confess with no args asks for the confession", /What is the confession/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/reply", {});
  ok("/reply with no args shows usage", /Usage/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/reply abc", {});
  ok("/reply with a non-numeric id is rejected", /positive integer/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/nonsense", {});
  ok("unknown command points at /help", /Unknown command/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("hello there", {});
  ok("plain text in a DM points at /help", /Only commands/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/help@WickedAICoffesionbot", {});
  ok("a /command@botname mention still routes", env.sentTo(ME).length === 1);
}
{
  const env = run("/HELP", {});
  ok("commands are case-insensitive", env.sentTo(ME).length === 1);
}

console.log("\n--- admin gating ---");
{
  const env = run("/setchannel -100999", { ADMIN_IDS: String(ME) });
  ok("admin can set the channel", /Channel set/.test(env.sentTo(ME)[0].payload.text), JSON.stringify(env.sentTo(ME).map((s) => s.payload.text)));
}
{
  const env = run("/setchannel -100999", { ADMIN_IDS: String(ME) }, OTHER);
  ok("non-admin is refused", /Admin only/.test(env.sentTo(OTHER)[0].payload.text));
}
{
  const env = run("/setchannel notanumber", { ADMIN_IDS: String(ME) });
  ok("non-numeric channel id is refused", /must be a number/.test(env.sentTo(ME)[0].payload.text));
}

console.log("\n--- rate limiting ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  let limited = 0;
  for (let i = 0; i < 8; i++) {
    env.reset();
    env.ctx.handleMessage(privateMsg("/comment topic" + i, ME).message);
    if (env.sentTo(ME).some((s) => /Slow down/.test(s.payload.text))) limited++;
  }
  ok("the 6th+ /comment in a minute is rate limited", limited === 3, "limited=" + limited);
}

console.log("\n--- HTML escaping ---");
{
  const env = run("/confess <script>alert(1)</script> & <b>bold</b>", {});
  const posted = env.sentTo(CH);
  // /confess posts TWO messages: the confession itself, then the bot's comment.
  ok("confession + comment are both posted to the channel", posted.length === 2, "posted=" + posted.length);
  const confession = posted[0] ? posted[0].payload.text : "";
  ok("confession text is HTML-escaped before posting", !/<script>/.test(confession), JSON.stringify(confession));
  ok("...and the ampersand is escaped too", /&amp;/.test(confession), JSON.stringify(confession));
  ok("...and the tag is neutralised as &lt;b&gt;", /&lt;b&gt;bold&lt;\/b&gt;/.test(confession), JSON.stringify(confession));
  ok("the comment is threaded under the confession", posted[1] && posted[1].payload.reply_to_message_id === 501, JSON.stringify(posted[1] && posted[1].payload));
}

console.log("\n--- /help reports auto-reply state honestly ---");
{
  const env = run("/help", { AUTO_REPLY: "true" });
  ok("AUTO_REPLY=true + channel set -> says on", /Auto-reply is <b>on<\/b>/.test(env.sentTo(ME)[0].payload.text));
}
{
  const env = run("/help", { AUTO_REPLY: "true", CONFESSION_CHANNEL_ID: "" });
  ok("AUTO_REPLY=true but NO channel -> warns instead of claiming it works", /no channel is set/.test(env.sentTo(ME)[0].payload.text), env.sentTo(ME)[0].payload.text);
}
{
  const env = run("/help", {});
  ok("AUTO_REPLY unset -> says nothing about auto-reply", !/Auto-reply/.test(env.sentTo(ME)[0].payload.text));
}

console.log("\n--- non-private chats ---");
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.handleMessage({
    message_id: 1,
    from: { id: OTHER, is_bot: false },
    chat: { id: -100777, type: "supergroup", title: "g" },
    text: "/start",
  });
  ok("group message gets 'talk to me in private'", /private chat/.test(env.sentTo("-100777")[0].payload.text));
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH } });
  env.ctx.handleMessage({
    message_id: 1,
    from: { id: OTHER, is_bot: true },
    chat: { id: OTHER, type: "private" },
    text: "/start",
  });
  ok("messages from other bots are ignored", env.telegram.length === 0);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
