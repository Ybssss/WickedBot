// Runs the WHOLE "Code.gs" against a stubbed Apps Script environment so the real
// Telegram update path can be exercised without a deployment.
//
// Modelled on the harness in "limit tester" (tests/lib/gas-env.js). The point is the
// same: a stub that is missing something the code reads fails as a CRASH inside the
// function under test, which reads like a production bug rather than a thin stub.
//
// It loads the entire file, so the measurement covers the real path an update takes:
// pollTelegram_ -> dedupe -> handleMessage -> route -> generateComment -> sendMessage.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE_PATH = path.join(__dirname, "..", "..", "Code.gs");

function classify(url) {
  if (url.indexOf("/getUpdates") !== -1) return "getUpdates";
  if (url.indexOf("/sendMessage") !== -1) return "sendMessage";
  if (url.indexOf(":generateContent") !== -1) return "generateContent";
  if (url.indexOf("/setMyCommands") !== -1) return "setMyCommands";
  if (url.indexOf("/setWebhook") !== -1) return "setWebhook";
  if (url.indexOf("/deleteWebhook") !== -1) return "deleteWebhook";
  if (url.indexOf("/getWebhookInfo") !== -1) return "getWebhookInfo";
  if (url.indexOf("/getMe") !== -1) return "getMe";
  if (url.indexOf("/getChatMember") !== -1) return "getChatMember";
  if (url.indexOf("/getChat") !== -1) return "getChat";
  return "other";
}

/**
 * Builds the environment.
 *
 * `opts.props` seeds Script Properties. `opts.gemini` controls the Gemini reply:
 * "ok" (default), "error" (non-2xx), or "empty" (no candidates).
 */
function buildEnv(opts) {
  opts = opts || {};

  const props = Object.assign(
    { TELEGRAM_BOT_TOKEN: "123:stub", GEMINI_API_KEY: "stub-key", ADMIN_IDS: "1790450430" },
    opts.props || {},
  );

  const cacheStore = {};
  const urlCalls = [];
  const telegram = [];
  const errors = [];
  const logs = [];
  const sheetRows = [];
  const triggers = [];
  let updateBatches = [];
  let forcedGetUpdates = null;
  let messageIdSeq = 500;
  const fetchOpts = { channelId: null, chatMemberStatus: "administrator" };

  /** The offset the code has stored, so getUpdates can filter like the real API. */
  function getOffset() {
    return Object.prototype.hasOwnProperty.call(props, "POLL_OFFSET") ? props.POLL_OFFSET : "0";
  }

  const scriptCache = {
    get: (k) => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
    put: (k, v) => {
      cacheStore[k] = v;
    },
    remove: (k) => {
      delete cacheStore[k];
    },
  };

  const sheet = {
    appendRow: (row) => sheetRows.push(row),
    // ⚠️ diagnose() READS THE LOG SHEET. A stub with only `appendRow` makes the real
    // Sheet API look like a crash inside the function under test — which reads as a
    // broken deployment rather than a thin stub.
    getLastRow: () => sheetRows.length + 1,
    getRange: () => ({ getValues: () => sheetRows.slice(-5) }),
  };
  const book = { getSheetByName: () => sheet, insertSheet: () => sheet };

  const scriptApp = {
    getProjectTriggers: () => triggers.slice(),    deleteTrigger: (t) => {
      const i = triggers.indexOf(t);
      if (i >= 0) triggers.splice(i, 1);
    },
    newTrigger: (fn) => ({
      timeBased: () => ({
        everyMinutes: (n) => ({
          create: () => {
            const t = { getHandlerFunction: () => fn, minutes: n };
            triggers.push(t);
            return t;
          },
        }),
      }),
    }),
  };

  const UrlFetchApp = {
    fetch: (url, o) => {
      const kind = classify(url);
      urlCalls.push({ kind, url, opts: o || null });

      if (kind === "sendMessage") {
        let payload;
        try {
          payload = JSON.parse((o && o.payload) || "{}");
        } catch (e) {
          payload = { _unparsed: (o && o.payload) || null };
        }
        telegram.push({ kind, payload, url });
        // ⚠️ A STUB THAT ALWAYS SAYS ok:true CANNOT SEE THE MOST COMMON CHANNEL FAILURE.
        // "bot is not an administrator" is a 403 on sendMessage, and the bot then posts
        // NOTHING while every line of code looks like it ran. `opts.send` models it.
        if (opts.send === "forbidden") {
          return {
            getResponseCode: () => 403,
            getContentText: () =>
              JSON.stringify({
                ok: false,
                error_code: 403,
                description: "Forbidden: bot is not a member of the channel chat",
              }),
          };
        }
        if (opts.send === "noRights") {
          return {
            getResponseCode: () => 400,
            getContentText: () =>
              JSON.stringify({
                ok: false,
                error_code: 400,
                description: "Bad Request: not enough rights to send text messages to the chat",
              }),
          };
        }
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { message_id: ++messageIdSeq } }),
        };
      }

      if (kind === "getUpdates") {
        if (forcedGetUpdates) {
          const r = forcedGetUpdates;
          return { getResponseCode: () => r.code, getContentText: () => r.body };
        }
        // ⚠️ REAL TELEGRAM FILTERS BY OFFSET: it returns only updates with
        // `update_id >= offset`, and CONFIRMS (deletes) everything below it. A stub that
        // ignores the offset cannot reproduce the one failure mode that is permanent —
        // an offset that has run past the live update ids returns an empty list forever,
        // with no error anywhere.
        const raw = updateBatches.length ? updateBatches.shift() : [];
        const off = Number(getOffset());
        const batch = raw.filter((u) => Number(u.update_id) >= off);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: batch }) };
      }

      if (kind === "generateContent") {
        if (opts.gemini === "error") {
          return { getResponseCode: () => 500, getContentText: () => JSON.stringify({ error: { message: "boom" } }) };
        }
        if (opts.gemini === "empty") {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [] }) };
        }
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "Nice one." }] } }] }),
        };
      }

      if (kind === "getMe") {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { id: 8945572488, is_bot: true, username: "WickedAICoffesionbot", first_name: "Wicked" } }),
        };
      }

      // ⚠️ A GENERIC `{ok:true,result:true}` MAKES diagnose() REPORT A FALSE PROBLEM.
      // `getChatMember` was read as `result.status === undefined`, which diagnose
      // correctly interprets as "not an admin" — so the stub, not the code, produced a
      // scary warning. Model the shapes the code actually reads.
      if (kind === "getChat") {
        const m = /chat_id=([^&]+)/.exec(url);
        const id = m ? decodeURIComponent(m[1]) : null;
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { id: Number(id), type: "channel", title: "Confessions" } }),
        };
      }

      if (kind === "getChatMember") {
        const status = fetchOpts.chatMemberStatus;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: { status, user: { id: 8945572488, is_bot: true } } }) };
      }

      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: true }) };
    },
  };

  // NOTE: standard intrinsics (Object, Array, Date, Set, RegExp, ...) are deliberately NOT
  // injected. A contextified vm object gets its own realm's intrinsics, and shadowing them with
  // host-realm copies is how `instanceof Date` silently becomes false — a trap the limit tester
  // harness documents at length.
  const ctx = {
    console: {
      log: (...a) => logs.push(a.map(String).join(" ")),
      error: (...a) => errors.push(a.map(String).join(" ")),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => {
          props[k] = String(v);
        },
        deleteProperty: (k) => {
          delete props[k];
        },
      }),
    },
    CacheService: { getScriptCache: () => scriptCache },
    SpreadsheetApp: { openById: () => book },
    UrlFetchApp,
    ScriptApp: scriptApp,
    ContentService: {
      createTextOutput: (t) => ({ text: t, setMimeType: () => ({ text: t, isResponse: true }) }),
      MimeType: { TEXT: "text/plain", JSON: "application/json" },
    },
    Logger: { log() {} },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SOURCE_PATH, "utf8"), ctx);

  return {
    ctx,
    props,
    cacheStore,
    urlCalls,
    telegram,
    errors,
    logs,
    sheetRows,
    triggers,

    /** Queue one getUpdates batch (returned by the next poll, FIFO). */
    queueUpdates(batch) {
      updateBatches.push(batch);
    },
    /** Arm a pollTelegram_ trigger, as setupPolling() would have. */
    armTrigger() {
      triggers.push({ getHandlerFunction: () => "pollTelegram_", minutes: 1 });
    },
    /** Set what getChatMember reports for the bot, e.g. "administrator" or "left". */
    setChatMemberStatus(status) {
      fetchOpts.chatMemberStatus = status;
    },
    /** Force getUpdates to fail, e.g. { code: 409, body: '{"ok":false,...}' }. */
    failGetUpdates(code, body) {
      forcedGetUpdates = { code, body };
    },
    /** Every sendMessage whose chat_id matches, in order. */
    sentTo(chatId) {
      return telegram.filter((t) => String(t.payload.chat_id) === String(chatId));
    },
    /** Chat ids the bot actually posted to. */
    chatsSent() {
      return telegram.map((t) => String(t.payload.chat_id));
    },
    /** Count of Gemini calls, to tell "silent" from "never even tried". */
    geminiCalls() {
      return urlCalls.filter((c) => c.kind === "generateContent").length;
    },
    reset() {
      telegram.length = 0;
      urlCalls.length = 0;
      errors.length = 0;
      logs.length = 0;
    },
  };
}

/** A private DM from `userId`. */
function privateMsg(text, userId, updateId) {
  return {
    update_id: updateId === undefined ? Math.floor(Math.random() * 1e9) : updateId,
    message: {
      message_id: 10,
      from: { id: userId || 42, is_bot: false, first_name: "YB", username: "YBcode_000" },
      chat: { id: userId || 42, type: "private" },
      date: 1700000000,
      text,
    },
  };
}

/**
 * A channel post as Telegram really sends it: `sender_chat`, and NO `from` at all.
 * The README calls this out explicitly; a stub that invents `from` would hide the
 * exact shape the auto-reply guard was fixed for.
 */
function channelPost(text, channelId, updateId, messageId) {
  const chat = { id: Number(channelId), type: "channel", title: "Confessions" };
  return {
    update_id: updateId === undefined ? Math.floor(Math.random() * 1e9) : updateId,
    channel_post: {
      message_id: messageId === undefined ? 10 : messageId,
      sender_chat: chat,
      chat,
      date: 1700000000,
      text,
    },
  };
}

/**
 * A channel post made BY THE BOT (its own comment), in Telegram's real shape.
 *
 * ⚠️ `sender_chat` IS THE CHANNEL, NOT THE BOT. For a `channel_post`, Telegram always sets
 * `sender_chat` to the channel itself — so a bot's own comment is **indistinguishable from a
 * user's post by `sender_chat`**, and there is no `from` at all. Modelling it as "sender_chat is
 * the bot" would have made a fix look correct while leaving the real hole open.
 *
 * Telegram DOES deliver the bot's own channel posts back through `getUpdates`, which is what
 * makes this shape the loop trigger.
 */
function channelPostFromBot(text, channelId, updateId, messageId) {
  const chat = { id: Number(channelId), type: "channel", title: "Confessions" };
  return {
    update_id: updateId === undefined ? Math.floor(Math.random() * 1e9) : updateId,
    channel_post: {
      message_id: messageId === undefined ? 11 : messageId,
      sender_chat: chat,
      chat,
      date: 1700000000,
      text,
    },
  };
}

module.exports = { buildEnv, privateMsg, channelPost, channelPostFromBot, SOURCE_PATH };
