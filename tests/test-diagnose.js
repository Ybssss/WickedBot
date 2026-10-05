// Smoke-tests diagnose() itself: it must run without throwing and must name the
// blocking problem for each broken configuration.
//
//   node tests/test-diagnose.js

"use strict";

const { buildEnv } = require("./lib/gas-env");

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

function diag(props, opts) {
  const env = buildEnv({ props });
  if (!opts || opts.armTrigger !== false) env.armTrigger();
  if (opts && opts.chatMemberStatus) env.setChatMemberStatus(opts.chatMemberStatus);
  let out = null;
  let err = null;
  try {
    out = env.ctx.diagnose();
  } catch (e) {
    err = e;
  }
  return { env, out, err };
}

console.log("\n--- diagnose() runs on a healthy config ---");
{
  const { out, err } = diag({ CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true", ADMIN_IDS: "1790450430" });
  ok("does not throw", err === null, err ? String(err) : "");
  ok("returns a report", typeof out === "string" && out.length > 0);
  ok("reports the channel id as OK", /CONFESSION_CHANNEL_ID is numeric/.test(out), out);
  ok("reports AUTO_REPLY as on", /AUTO_REPLY is on/.test(out), out);
  ok("sees the armed trigger", /Exactly one pollTelegram_ trigger/.test(out), out);
  ok("reports the bot as a channel admin", /Bot is an admin in the channel/.test(out), out);
  ok("reports NO blocking problem", /No blocking problem found/.test(out), out);
}

console.log("\n--- diagnose() catches each blocking misconfiguration ---");
{
  const { out } = diag({ CONFESSION_CHANNEL_ID: CH }, { armTrigger: false });
  ok("AUTO_REPLY missing is flagged", /AUTO_REPLY is not set/.test(out), out);
  ok("...and named as the first fix", /FIX THIS FIRST: Set AUTO_REPLY/.test(out), out);
}
{
  const { out } = diag({ CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "yes" });
  ok("AUTO_REPLY='yes' is flagged as not exactly true", /AUTO_REPLY is set but not to "true"/.test(out), out);
}
{
  // After the fix, a stray capital is accepted — so it must NOT be flagged.
  const { out } = diag({ CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "TRUE" });
  ok("AUTO_REPLY='TRUE' is accepted (trim+lowercase)", /AUTO_REPLY is on/.test(out), out);
}
{
  const { out } = diag({ CONFESSION_CHANNEL_ID: "@mychannel", AUTO_REPLY: "true" });
  ok("non-numeric channel id is flagged", /CONFESSION_CHANNEL_ID is not a plain number/.test(out), out);
}
{
  const { out } = diag({ AUTO_REPLY: "true" });
  ok("missing channel id is flagged", /CONFESSION_CHANNEL_ID is not set/.test(out), out);
}
{
  const { out } = diag({ CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" }, { armTrigger: false });
  ok("missing trigger is flagged", /No pollTelegram_ trigger exists/.test(out), out);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.armTrigger();
  env.armTrigger();
  const out = env.ctx.diagnose();
  ok("duplicate triggers are flagged", /More than one pollTelegram_ trigger/.test(out), out);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.armTrigger();
  delete env.props.TELEGRAM_BOT_TOKEN;
  let out = "";
  try {
    out = env.ctx.diagnose();
  } catch (e) {
    out = "THREW: " + e;
  }
  ok("missing token is flagged", /TELEGRAM_BOT_TOKEN is missing/.test(out), out);
  ok("...and diagnose() itself does not throw", !/^THREW/.test(out), out);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.armTrigger();
  const realFetch = env.ctx.UrlFetchApp.fetch;
  env.ctx.UrlFetchApp.fetch = function (url, o) {
    if (String(url).indexOf("/getWebhookInfo") !== -1) {
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: { url: "https://example.com/hook", pending_update_count: 3 } }) };
    }
    return realFetch(url, o);
  };
  const out = env.ctx.diagnose();
  ok("an armed webhook is flagged as blocking polling", /A webhook is still registered/.test(out), out);
  ok("...and the fix points at setupPolling()", /Run setupPolling\(\)/.test(out), out);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.armTrigger();
  env.setChatMemberStatus("left");
  const out = env.ctx.diagnose();
  ok("a non-admin bot is flagged", /Bot is NOT an admin/.test(out), out);
  ok("...and the fix explains the 403", /Post Messages/.test(out), out);
}
{
  const env = buildEnv({ props: { CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" } });
  env.armTrigger();
  const realFetch = env.ctx.UrlFetchApp.fetch;
  env.ctx.UrlFetchApp.fetch = function (url, o) {
    if (String(url).indexOf("/getMe") !== -1) {
      return { getResponseCode: () => 401, getContentText: () => JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }) };
    }
    return realFetch(url, o);
  };
  const out = env.ctx.diagnose();
  ok("a revoked token is flagged", /Telegram rejected the token/.test(out), out);
}

console.log("\n--- diagnose() sends nothing ---");
{
  const { env } = diag({ CONFESSION_CHANNEL_ID: CH, AUTO_REPLY: "true" });
  ok("no sendMessage was issued", env.telegram.length === 0, JSON.stringify(env.chatsSent()));
  ok("no script property was written", env.props.POLL_OFFSET === undefined, "POLL_OFFSET=" + env.props.POLL_OFFSET);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
