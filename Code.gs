/* === WICKEDBOT: Telegram Confession Bot (single-file version) ===
   Consolidates Config, Telegram, Bot, and Gemini modules into one
   script to eliminate multi-file deployment confusion.
   Author: Ares orchestration. Project: WickedBot. 2026-09-02.

   Setup:
   1. Create new GAS project (or open existing), delete all existing files.
   2. Create a single file named exactly: Code
   3. Paste this entire file (from line 1 to end) into that file.
   4. Set Script Properties (gear icon):
      TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, ADMIN_IDS, AUTO_REPLY, CONFESSION_CHANNEL_ID
      WEBHOOK_SECRET (optional; unused unless you deliberately re-arm the webhook)
   5. Make the bot an ADMIN of the channel, with Post Messages.
   6. Open the editor dropdown -> select 'setupPolling': Run (one-time). This deletes any
      webhook and installs the 1-minute poll trigger. THEN run 'registerCommands' once.
   7. DM bot /start -> should respond within ~60s. /help -> command list.
   8. If it is silent, run 'diagnose' and read View -> Logs. It names the first thing to fix.

   DO NOT deploy a web app or run 'setupWebhook'. Apps Script's ContentService always answers
   a webhook with a 302, Telegram counts that as failed delivery and retries forever, so only
   the first update ever gets through. Polling is the live ingress. An armed webhook also makes
   getUpdates fail with 409, which silences the bot completely — run 'setupPolling' to clear it.

   WARNING: the user pasted their real Gemini API key in this chat. The key is
   now in the conversation transcript. It is NEVER embedded in source code
   (read only from PropertiesService at runtime), but the user should rotate
   it at https://aistudio.google.com/apikey to prevent any accidental exposure.
*/

'use strict';

/* --- CONFIG --- */
const BOT_VERSION = '1.0.0';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const TELEGRAM_API_BASE_ = 'https://api.telegram.org';
const LOG_SHEET_ID = '174KDDCMnU5CwAOr0bxuzQHD-L5wrV2C14dObwgFIPWc';
const LOG_SHEET_NAME = 'logs';
const WEBHOOK_URL_ = 'https://script.google.com/macros/s/AKfycbyYL3WgUNBGRNwN06EJu9XsQLaqW0E-K1T3SjDjDRi9Dwz5Y3pw0zdWfDd9MpdHZI5l-Q/exec';
const WEBHOOK_SECRET_HEADER_ = 'X-Webhook-Secret';
const WEBHOOK_SECRET_PARAM_ = 'secret';
const CHANNEL_REPLY_MIN_HARD_ = 15;
// Bot-posted channel message ids, so the bot never answers its own comment.
// Telegram reports EVERY channel post with `sender_chat` = the channel itself and no
// `from` at all, so the bot's own post is indistinguishable from a user's by any field.
// The message_id returned by sendMessage is the only reliable signal.
const BOT_MSG_KEY_PREFIX_ = 'botmsg_';
const BOT_MSG_TTL_SECONDS_ = 21600; // CacheService maximum (6 hours)

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN in Script Properties');
  const geminiKey = props.getProperty('GEMINI_API_KEY') || '';
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  const rawChannelId = props.getProperty('CONFESSION_CHANNEL_ID') || '';
  const channelId = /^-?\d+$/.test(rawChannelId.trim()) ? rawChannelId.trim() : null;
  const adminRaw = props.getProperty('ADMIN_IDS') || '';
  const adminIds = new Set(adminRaw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; }).map(Number));
  return { token: token, geminiKey: geminiKey, model: model, channelId: channelId, adminIds: adminIds, version: BOT_VERSION };
}

function getAdminIds() { return getConfig().adminIds; }
function getChannelId() { return getConfig().channelId; }
function setChannelId(id) {
  if (id === null || id === undefined || !/^-?\d+$/.test(String(id).trim())) throw new Error('Invalid channel id: ' + String(id));
  PropertiesService.getScriptProperties().setProperty('CONFESSION_CHANNEL_ID', String(id).trim());
}
function isAdmin(userId) { if (userId === null || userId === undefined) return false; return getAdminIds().has(Number(userId)); }

/* --- WEBHOOK SECRET --- */
function webhookSecret_() { return PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || ''; }
function isWebhookAuthed_(e) {
  const expected = webhookSecret_();
  if (!expected) return false;
  try {
    if (e.parameter && e.parameter[WEBHOOK_SECRET_PARAM_]) return e.parameter[WEBHOOK_SECRET_PARAM_] === expected;
  } catch (err) {}
  try {
    const headers = (e.headers) ? e.headers : {};
    for (const key in headers) {
      if (String(key).toLowerCase() === WEBHOOK_SECRET_HEADER_.toLowerCase()) return String(headers[key]) === expected;
    }
  } catch (err) {}
  return false;
}
function deny_(message) {
  message = message || 'unauthorized';
  const out = ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

/* --- HTML ESCAPE --- */
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function postCommentHtml_(comment) {
  return '<b>Comment:</b>\n\n' + escapeHtml(String(comment || ''));
}

/* --- OWN-MESSAGE TRACKING --- */
function rememberBotMessage_(chatId, messageId) {
  if (messageId === undefined || messageId === null) return;
  try { CacheService.getScriptCache().put(BOT_MSG_KEY_PREFIX_ + String(chatId) + '_' + String(messageId), '1', BOT_MSG_TTL_SECONDS_); } catch (e) {}
}
function isOwnChannelMessage_(chatId, messageId) {
  if (messageId === undefined || messageId === null) return false;
  try { return CacheService.getScriptCache().get(BOT_MSG_KEY_PREFIX_ + String(chatId) + '_' + String(messageId)) === '1'; } catch (e) { return false; }
}

/* --- AUTO_REPLY FLAG --- */
// Read in one place so /help and the listener can never disagree, and so the
// comparison tolerates 'True' / 'TRUE' / ' true ' instead of silently meaning "off".
function autoReplyEnabled_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('AUTO_REPLY');
    return String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase() === 'true';
  } catch (e) { return false; }
}

let _logSheetCache_ = null;
function logToSheet_(row) { try { if (!_logSheetCache_) { const ss = SpreadsheetApp.openById(LOG_SHEET_ID); let sh = ss.getSheetByName(LOG_SHEET_NAME); if (!sh) { sh = ss.insertSheet(LOG_SHEET_NAME); sh.appendRow(['timestamp','update_id','chat_id','chat_type','user_id','username','text','parsed_command','action','error','webhook_url']); } _logSheetCache_ = sh; } _logSheetCache_.appendRow(row); } catch (e) { _logSheetCache_ = null; console.error('logToSheet_:', e); } }
function logUpdate_(update, parsed, action, error) { try { const msg = update.message || update.channel_post || update.edited_message || {}; const chat = msg.chat || {}; const from = msg.from || {}; const text = msg.text || JSON.stringify(update).substring(0,500); const row = [ new Date().toISOString(), update.update_id || '', chat.id || '', chat.type || (update.channel_post ? 'channel' : ''), from.id || '', from.username || '', String(text).substring(0,500), parsed ? parsed.command : '', action || '', error ? String(error).substring(0,500) : '', '' ]; logToSheet_(row); } catch(e){} }

/* --- WEBHOOK & COMMAND REGISTRATION --- */
function setupWebhook() {
  const cfg = getConfig();
  const secret = webhookSecret_();
  const url = secret ? (WEBHOOK_URL_ + '?' + WEBHOOK_SECRET_PARAM_ + '=' + encodeURIComponent(secret)) : WEBHOOK_URL_;
  // Stop polling triggers before switching to webhook to avoid dual delivery
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) if (triggers[i].getHandlerFunction() === 'pollTelegram_') ScriptApp.deleteTrigger(triggers[i]);
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/setWebhook?url=' + encodeURIComponent(url) + '&drop_pending_updates=true';
  const resp = UrlFetchApp.fetch(apiUrl, { method: 'get', muteHttpExceptions: false });
  console.log('setupWebhook: code=' + resp.getResponseCode() + ' body=' + resp.getContentText() + ' secretSet=' + !!secret);
  registerCommands();
}

function deleteWebhook() {
  const cfg = getConfig();
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/deleteWebhook?drop_pending_updates=true';
  const resp = UrlFetchApp.fetch(apiUrl, { method: 'post', muteHttpExceptions: true });
  const body = resp.getContentText();
  console.log('deleteWebhook: code=' + resp.getResponseCode() + ' body=' + body);
  // Report success honestly: setupPolling rewinds the offset on the strength of this call,
  // and a silent failure here is what turns a stale queue into a replay.
  let ok = false;
  try { ok = JSON.parse(body).ok === true; } catch (e) { ok = false; }
  if (!ok) console.error('deleteWebhook: FAILED (code ' + resp.getResponseCode() + ') — the webhook may still be armed, which blocks getUpdates with 409');
  return ok;
}

function pollTelegram_() {
  const cfg = getConfig();
  const props = PropertiesService.getScriptProperties();
  const dupCache = CacheService.getScriptCache();
  let offset = parseInt(props.getProperty('POLL_OFFSET') || '0', 10);
  if (isNaN(offset)) offset = 0;
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/getUpdates?timeout=5&limit=20&offset=' + offset;
  let resp;
  try { resp = UrlFetchApp.fetch(apiUrl, { method: 'get', muteHttpExceptions: true }); } catch(e){ console.error('pollTelegram_: fetch failed', e); return; }
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >=300) {
    // 409 means a webhook is still armed, and Telegram refuses getUpdates while one is set.
    // It is the single most likely cause of total silence, and the bare status code does not
    // say so — spell it out, because this log line is the only trace the owner will find.
    if (resp.getResponseCode() === 409) {
      console.error('pollTelegram_: 409 CONFLICT — a webhook is still registered, so Telegram refuses getUpdates and the bot receives NOTHING. Run setupPolling() (it calls deleteWebhook first), or diagnose() to confirm.');
    } else if (resp.getResponseCode() === 401) {
      console.error('pollTelegram_: 401 UNAUTHORIZED — TELEGRAM_BOT_TOKEN is wrong or was revoked in BotFather. Copy the current token into Script Properties.');
    } else {
      console.error('pollTelegram_: http '+resp.getResponseCode()+' '+resp.getContentText());
    }
    return;
  }
  let data; try { data = JSON.parse(resp.getContentText()); } catch(e){ console.error('pollTelegram_: parse', e); return; }
  if (!data.ok || !data.result || data.result.length===0) return;
  let maxId = offset;
  for (let i=0;i<data.result.length;i++) {
    const update = data.result[i];
    const uid = update.update_id;
    // Skip already-processed updates (same dedup as doPost webhook)
    if (uid !== undefined && uid !== null) {
      const dupKey = 'upd_' + String(uid);
      if (dupCache.get(dupKey)) { console.log('pollTelegram_: duplicate update_id ' + uid + ' skipped'); continue; }
      try { dupCache.put(dupKey, '1', 600); } catch (e2) {}
    }
    if (uid >= maxId) maxId = uid + 1;
    try {
      // Single listener: channel posts go through handleMessage as well, so the
      // AUTO_REPLY check lives in exactly one place. That copy guards `from`,
      // which is normally absent on channel_post (Telegram sends sender_chat).
      if (update.message) handleMessage(update.message);
      else if (update.channel_post) handleMessage(update.channel_post);
    } catch(e){ console.error('pollTelegram_ handle', e); }
    try { props.setProperty('POLL_OFFSET', String(maxId)); } catch(e){}
  }
}

function setupPolling() {
  deleteWebhook(); // also drops the pending queue, so rewinding the offset cannot replay anything
  const props = PropertiesService.getScriptProperties();
  // Reset the offset UNCONDITIONALLY. It must not be preserved: Telegram assigns a RANDOM
  // update_id after a week with no updates, so a stored offset can end up ABOVE every future
  // update — and getUpdates only ever returns updates with update_id >= offset. The bot then
  // polls forever, gets an empty list, and logs no error at all: total silence that looks
  // exactly like a dead trigger. deleteWebhook() above already dropped the pending queue, so
  // starting from 0 cannot replay old updates.
  props.setProperty('POLL_OFFSET', '0');
  const triggers = ScriptApp.getProjectTriggers();
  for (let i=0;i<triggers.length;i++) if (triggers[i].getHandlerFunction()==='pollTelegram_') ScriptApp.deleteTrigger(triggers[i]);
  ScriptApp.newTrigger('pollTelegram_').timeBased().everyMinutes(1).create();
  console.log('setupPolling: created 1m trigger, webhook deleted, offset reset to 0');
}

function stopPolling() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i=0;i<triggers.length;i++) if (triggers[i].getHandlerFunction()==='pollTelegram_') ScriptApp.deleteTrigger(triggers[i]);
  console.log('stopPolling: removed poll triggers. Webhook NOT re-armed — call setupWebhook() explicitly if you really want it.');
}

function registerCommands() {
  const cfg = getConfig();
  const commands = [
    { command: 'start', description: 'Show welcome message' },
    { command: 'help', description: 'List all commands' },
    { command: 'comment', description: 'Generate a witty comment on a topic. Usage: /comment <text>' },
    { command: 'confess', description: 'Post anonymous confession + bot comment. Usage: /confess <message>' },
    { command: 'reply', description: 'Comment under a channel post. Usage: /reply <id> [hint]' },
    { command: 'setchannel', description: 'Admin only: configure confession channel. Usage: /setchannel <id>' }
  ];
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/setMyCommands';
  const resp = UrlFetchApp.fetch(apiUrl, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ commands: commands }), muteHttpExceptions: true
  });
  console.log('registerCommands: ' + resp.getResponseCode() + ' ' + resp.getContentText());
}

/* --- MESSAGE SENDER WITH REPLY SUPPORT --- */
function sendMessage(chatId, text, opts) {
  if (!opts) opts = {};
  const safeText = String(text || '');
  const cfg = getConfig();
  const chunks = chunkText(safeText, 4000);
  const replyToMessageId = (opts && opts.replyToMessageId !== undefined && opts.replyToMessageId !== null) ? opts.replyToMessageId : undefined;
  let lastResponse = null;

  for (let i = 0; i < chunks.length; i++) {
    const body = { chat_id: chatId, text: chunks[i], parse_mode: 'HTML', disable_web_page_preview: true };
    if (i === 0 && replyToMessageId !== undefined) body.reply_to_message_id = replyToMessageId;
    const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/sendMessage';
    let response;
    try {
      response = UrlFetchApp.fetch(apiUrl, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    } catch (err) { console.error('sendMessage: network error', err); throw err; }
    const code = response.getResponseCode();
    const raw = response.getContentText();
    if (code < 200 || code >= 300) console.error('sendMessage: HTTP ' + code + ' chat=' + chatId + ' body=' + raw);
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.ok) console.error('sendMessage: ok=false chat=' + chatId + ' desc=' + (parsed.description || '(none)'));
      lastResponse = parsed;
    } catch (e) { console.error('sendMessage: parse error', e, raw); }
  }
  return lastResponse;
}

function chunkText(text, maxLen) {
  const chunks = [];
  let current = '';
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current.length + line.length + 1 <= maxLen) current += (current === '' ? '' : '\n') + line;
    else { chunks.push(current); current = line; }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/* --- GEMINI --- */
var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
function generateComment(topic, context) {
  const fallback = 'I had nothing to say for once.';
  if (!topic || typeof topic !== 'string') return fallback;
  const cfg = getConfig();
  if (!cfg || !cfg.geminiKey || !cfg.model) { console.error('generateComment: missing config'); return fallback; }
  const safeTopic = truncateText(topic, 500);
  const safeContext = truncateText(context || 'none', 500);
  const url = GEMINI_API_BASE + '/' + encodeURIComponent(cfg.model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey);
  const systemPrompt = 'You are an anonymous, witty participant in a college-style confession channel. ' +
    'Someone just posted or asked about a topic, and you are leaving a short comment in the thread. ' +
    'Write ONE short comment (1-3 sentences, max 800 characters). Be casual, specific when given context, clever. ' +
    'Mild snark is OK; cruelty is not. Do NOT use slurs, threats, or anything targeting protected characteristics. ' +
    'Do NOT include emojis. Do NOT use markdown. Just plain text. No preamble, no explanation — just the comment itself.';
  const userPayload = 'Topic: ' + safeTopic + '\nContext: ' + safeContext;
  const body = {
    contents: [{ parts: [{ text: systemPrompt + '\n\n' + userPayload }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 400, topP: 0.95 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };
  let response;
  try {
    response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  } catch (err) { console.error('generateComment: fetch threw:', err); return fallback; }
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) { console.error('generateComment: non-2xx ' + code); return fallback; }
  try {
    const parsed = JSON.parse(response.getContentText());
    const text = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] ? parsed.candidates[0].content.parts[0].text : null;
    if (text && typeof text === 'string') {
      const trimmed = text.trim();
      return trimmed.length > 800 ? trimmed.substring(0, 800) : trimmed;
    }
  } catch (e) { console.error('generateComment: parse error:', e); }
  return fallback;
}
function generateRoast(target, context) { return generateComment(target, context); }
function truncateText(s, max) { const str = String(s || ''); return str.length > max ? str.substring(0, max) : str; }

/* --- COMMAND HANDLERS --- */
const COMMANDS = [
  { name: 'start', description: 'Show a welcome message.' },
  { name: 'help', description: 'List all commands.' },
  { name: 'comment', description: 'Generate a witty comment. Usage: /comment <text>' },
  { name: 'confess', description: 'Post anonymous confession + bot comment. Usage: /confess <message>' },
  { name: 'reply', description: 'Comment under a channel post. Usage: /reply <id> [hint]' },
  { name: 'setchannel', description: 'Admin only. Usage: /setchannel <channel_id>' }
];

function cmdStart(msg) {
  sendMessage(msg.chat.id, '<b>CommentBot</b>\n\nI comment on confessions in the channel.\n\nType /help.');
}

function cmdHelp(msg) {
  const lines = ['<b>Available commands</b>\n'];
  for (let i = 0; i < COMMANDS.length; i++) { lines.push('/' + COMMANDS[i].name + ' — ' + escapeHtml(COMMANDS[i].description)); }
  lines.push('\nAdmins can also use /setchannel to configure the channel.');
  const on = autoReplyEnabled_();
  const ch = getChannelId();
  if (on && !ch) lines.push('\nAuto-reply is <b>on</b> but no channel is set — /setchannel &lt;id&gt;.');
  else if (on) lines.push('\nAuto-reply is <b>on</b> — the bot comments on every new channel post.');
  sendMessage(msg.chat.id, lines.join('\n'));
}

function cmdComment(msg, args) {
  const topic = (args || '').trim();
  if (!topic) { sendMessage(msg.chat.id, 'What topic? Usage: <code>/comment &lt;text&gt;</code>'); return; }
  if (checkRateLimit(msg.from.id, 'comment')) { sendMessage(msg.chat.id, 'Slow down. Try again in a minute.'); return; }
  const ch = getChannelId();
  if (!ch) { sendMessage(msg.chat.id, 'No channel configured yet. /setchannel <id>'); return; }
  let c; try { c = generateComment(topic, ''); } catch (e) { console.error('cmdComment:', e); sendMessage(msg.chat.id, 'Brain short-circuited. Try again.'); return; }
  if (!c || c.trim().length === 0) { sendMessage(msg.chat.id, 'I came up blank. Try a different topic.'); return; }
  postCommentToChannel(c);
  sendMessage(msg.chat.id, 'Posted a comment to the channel.');
}

function cmdRoast(msg, args) { return cmdComment(msg, args); }

function cmdConfess(msg, args) {
  const text = (args || '').trim();
  if (!text) { sendMessage(msg.chat.id, 'What is the confession? Usage: <code>/confess &lt;message&gt;</code>'); return; }
  if (checkRateLimit(msg.from.id, 'confess')) { sendMessage(msg.chat.id, 'Slow down. Try again in a minute.'); return; }
  const ch = getChannelId();
  if (!ch) { sendMessage(msg.chat.id, 'No channel configured. /setchannel <id>'); return; }
  const leadIn = '<b>Anonymous confession:</b>\n\n' + escapeHtml(text);
  const resp = postToChannelWithResult(ch, leadIn);
  if (!resp || !resp.ok) { sendMessage(msg.chat.id, 'Could not post. Check bot permissions in the channel.'); return; }
  const confId = (resp.result && resp.result.message_id) ? resp.result.message_id : null;
  if (confId) rememberBotMessage_(ch, confId);
  let comment; try { comment = generateComment(text, ''); } catch (e) { console.error('cmdConfess:', e); }
  if (comment && comment.trim().length > 0) {
    const cResp = confId ? sendMessage(ch, postCommentHtml_(comment), { replyToMessageId: confId }) : sendMessage(ch, postCommentHtml_(comment));
    if (cResp && cResp.ok && cResp.result && cResp.result.message_id) rememberBotMessage_(ch, cResp.result.message_id);
  }
  sendMessage(msg.chat.id, 'Posted anonymously. And I had thoughts.');
}

function cmdReply(msg, args) {
  const raw = (args || '').trim();
  if (!raw) { sendMessage(msg.chat.id, 'Usage: <code>/reply &lt;message_id&gt; [hint]</code>'); return; }
  if (checkRateLimit(msg.from.id, 'reply')) { sendMessage(msg.chat.id, 'Slow down. Try again in a minute.'); return; }
  const spaceIdx = raw.search(/\s/);
  const idStr = (spaceIdx === -1) ? raw : raw.substring(0, spaceIdx);
  const hint = (spaceIdx === -1) ? '' : raw.substring(spaceIdx + 1).trim();
  if (!/^\d+$/.test(idStr) || Number(idStr) <= 0) { sendMessage(msg.chat.id, 'message_id must be a positive integer. Usage: <code>/reply &lt;id&gt; [hint]</code>'); return; }
  const ch = getChannelId();
  if (!ch) { sendMessage(msg.chat.id, 'No channel configured. /setchannel <id>'); return; }
  const topic = hint || ('in response to post #' + idStr);
  const context = hint ? ('Replying to message #' + idStr + '. ' + hint) : ('Replying to message #' + idStr + ' without original text; comment generally.');
  let c; try { c = generateComment(topic, context); } catch (e) { console.error('cmdReply:', e); sendMessage(msg.chat.id, 'Brain short-circuited. Try again.'); return; }
  if (!c || c.trim().length === 0) { sendMessage(msg.chat.id, 'Came up blank. Try a different hint.'); return; }
  const resp = sendMessage(ch, '<b>Comment on #' + idStr + ':</b>\n\n' + escapeHtml(String(c || '')), { replyToMessageId: Number(idStr) });
  if (resp && resp.ok && resp.result && resp.result.message_id) rememberBotMessage_(ch, resp.result.message_id);
  if (resp && resp.ok) sendMessage(msg.chat.id, 'Comment posted as reply to post #' + idStr + '.');
  else sendMessage(msg.chat.id, 'Could not post reply. Check bot permissions and message id.');
}

function cmdSetChannel(msg, args) {
  if (!isAdmin(msg.from.id)) { sendMessage(msg.chat.id, 'Admin only.'); return; }
  const requested = (args || '').trim();
  if (!requested) {
    const current = getChannelId();
    sendMessage(msg.chat.id, (current ? 'Current channel: <code>' + escapeHtml(current) + '</code>' : 'No channel set. Usage: <code>/setchannel &lt;id&gt;</code>'));
    return;
  }
  if (!/^-?\d+$/.test(requested)) { sendMessage(msg.chat.id, 'Channel id must be a number. Usage: <code>/setchannel &lt;id&gt;</code>'); return; }
  const test = postToChannel(requested, '<b>Bot connected.</b>');
  if (!test) { sendMessage(msg.chat.id, 'Could not send to channel ' + escapeHtml(requested) + '. Make sure bot is admin with Post Messages.'); return; }
  setChannelId(requested);
  sendMessage(msg.chat.id, 'Channel set to <code>' + escapeHtml(requested) + '</code>. Confessions will go here now.');
}

function checkRateLimit(userId, command) {
  if (!userId) return false;
  const bucket = Math.floor(Date.now() / 60000);
  const key = 'rl_' + String(userId) + '_' + command + '_' + bucket;
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 5) return true;
  cache.put(key, String(count + 1), 600);
  return false;
}

function channelReplyQuotaHit_() {
  const cache = CacheService.getScriptCache();
  const key = 'rl_channel_' + Math.floor(Date.now() / 60000);
  const raw = cache.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= CHANNEL_REPLY_MIN_HARD_) return true;
  try { cache.put(key, String(count + 1), 600); } catch (err2) {}
  return false;
}

function parseCommand(text) {
  if (!text || text.charAt(0) !== '/') return null;
  const body = text.substring(1);
  const spaceIdx = body.search(/\s/);
  let head = (spaceIdx === -1) ? body : body.substring(0, spaceIdx);
  let tail = (spaceIdx === -1) ? '' : body.substring(spaceIdx + 1);
  const atIdx = head.indexOf('@');
  if (atIdx !== -1) head = head.substring(0, atIdx);
  head = head.toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return null;
  return { command: head, args: tail.trim() };
}

/* --- CHANNEL POSTING --- */
function postCommentToChannel(comment) {
  const ch = getChannelId();
  if (!ch) return false;
  return postToChannel(ch, postCommentHtml_(comment));
}
function postRoastToChannel(roast) { return postCommentToChannel(roast); }
function postToChannel(channelId, body) {
  const resp = sendMessage(channelId, body);
  if (resp && resp.ok && resp.result && resp.result.message_id) rememberBotMessage_(channelId, resp.result.message_id);
  return !!(resp && resp.ok === true);
}
function postToChannelWithResult(channelId, body) {
  const resp = sendMessage(channelId, body);
  return resp || null;
}

/* --- WEBHOOK ENTRYPOINT --- */
function doGet(e) {
  return deny_();
}

function doPost(e) {
  if (!isWebhookAuthed_(e)) {
    console.log('doPost: missing secret (secretSet=' + (webhookSecret_() ? 1 : 0) + ')');
    return deny_();
  }
  let update;
  try { update = JSON.parse(e.postData.contents); } catch (err) {
    console.error('doPost: bad JSON', err);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad_json' })).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    const uid = update.update_id;
    if (uid !== undefined && uid !== null) {
      const dupCache = CacheService.getScriptCache();
      const dupKey = 'upd_' + String(uid);
      if (dupCache.get(dupKey)) {
        console.log('doPost: duplicate update_id ' + uid + ' ignored');
        try { logUpdate_(update, null, 'duplicate_ignored', null); } catch(_e){}
        return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
      }
      try { dupCache.put(dupKey, '1', 600); } catch (e2) {}
    }
    // logUpdate_ deferred to handleMessage to avoid pre-reply SpreadsheetApp latency (302 retry flood)
    // channel posts: dispatch to handleMessage so the AUTO_REPLY listener can fire
    if (update.channel_post) {
      handleMessage(update.channel_post);
      return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
    }
    if (update.edited_channel_post) { console.log('doPost: edited_channel_post ignored'); return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON); }
    if (update.message) handleMessage(update.message);
    else if (update.edited_message) console.log('doPost: edited_message ignored');
    else if (update.callback_query) console.log('doPost: callback_query ignored');
    else console.log('doPost: no message / edited / callback');
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('doPost: unhandled error:', err);
    try {
      if (update.message && update.message.chat && update.message.chat.id) {
        sendMessage(update.message.chat.id, 'Something went wrong. Try again, or yell at my human.');
      }
    } catch (innerErr) { console.error('doPost: inner error:', innerErr); }
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'handler_failed' })).setMimeType(ContentService.MimeType.JSON);
  }
}

/* --- MESSAGE HANDLER --- */
const PRIVATE_ONLY_MESSAGE = 'Please talk to me in a private chat.';
function handleMessage(msg) {
  try {
    if (!msg || !msg.chat) { console.log('handleMessage: no chat'); try{ logUpdate_({message: msg||{}}, null, 'no_chat', null);}catch(_e){} return; }
    if (msg.from && msg.from.is_bot) { console.log('handleMessage: ignore bot'); try{ logUpdate_({message: msg}, null, 'bot_ignored', null);}catch(_e){} return; }
    const autoReplyOn = autoReplyEnabled_();
    const chId = getChannelId();
    // Channel listener: opt-in via AUTO_REPLY script property
    if (autoReplyOn && chId && String(msg.chat.id) === String(chId)) {
      // Never answer the bot's own comment. Telegram echoes a channel's posts back through
      // getUpdates — including the bot's — and reports every one of them with `sender_chat`
      // set to the CHANNEL and no `from`, so there is no field that tells them apart. Without
      // this check the bot replies to itself, and that reply is itself a channel post.
      if (isOwnChannelMessage_(msg.chat.id, msg.message_id)) {
        console.log('listener: own channel post ' + msg.message_id + ' ignored');
        try { logUpdate_({ message: msg }, null, 'own_post_ignored', null); } catch (_e) {}
        return;
      }
      // `text` only — a photo/video post carries `caption`, so those are skipped.
      if (msg.text) {
        const trimmed = String(msg.text).trim();
        if (trimmed.charAt(0) !== '/') {
          if (channelReplyQuotaHit_()) {
            console.log('listener: channel auto-reply muted (quota)');
          } else {
            let c; try { c = generateComment(trimmed, ''); } catch (e) { console.error('listener:', e); }
            if (c && c.trim().length > 0) {
              const resp = sendMessage(chId, postCommentHtml_(c), { replyToMessageId: msg.message_id });
              if (resp && resp.ok && resp.result && resp.result.message_id) rememberBotMessage_(chId, resp.result.message_id);
            }
          }
        }
      } else {
        console.log('listener: channel post has no text (media/caption) — skipped');
        try { logUpdate_({ message: msg }, null, 'channel_media_skipped', null); } catch (_e) {}
      }
      return;
    }
    // Never nag channel chats. With AUTO_REPLY off, a channel post must be
    // ignored silently rather than answered with the "DM me" notice.
    if (msg.chat.type === 'channel') { console.log('handleMessage: channel post ignored (auto-reply off)'); try{ logUpdate_({message: msg}, null, 'channel_ignored', null);}catch(_e){} return; }
    if (msg.chat.type !== 'private') {
      sendMessage(msg.chat.id, escapeHtml(PRIVATE_ONLY_MESSAGE));
      try{ logUpdate_({message: msg}, null, 'non_private_ignored', null);}catch(_e){}
      return;
    }
    const text = (msg.text || '').trim();
    if (text.length === 0) { try{ logUpdate_({message: msg}, null, 'empty_text', null);}catch(_e){} return; }
    if (text.charAt(0) !== '/') {
      sendMessage(msg.chat.id, 'Only commands. Type /help.');
      return;
    }
    const parsed = parseCommand(text);
    if (!parsed) {
      sendMessage(msg.chat.id, 'Could not parse command. Type /help.');
      return;
    }
    switch (parsed.command) {
      case 'start': cmdStart(msg); break;
      case 'help': cmdHelp(msg); break;
      case 'comment': cmdComment(msg, parsed.args); break;
      case 'roast': cmdComment(msg, parsed.args); break;
      case 'confess': cmdConfess(msg, parsed.args); break;
      case 'reply': cmdReply(msg, parsed.args); break;
      case 'setchannel': cmdSetChannel(msg, parsed.args); break;
      default: sendMessage(msg.chat.id, 'Unknown command. Type /help.');
    }
    try{ logUpdate_({message: msg}, parsed, 'dispatch_'+parsed.command, null);}catch(_e){}
    return;
  } catch (err) {
    console.error('handleMessage: error:', err);
    try{ logUpdate_({message: msg||{}}, null, 'handle_error', err);}catch(_e){}
    try { if (msg && msg.chat && msg.chat.id) sendMessage(msg.chat.id, 'Error. Try again.'); } catch (e2) {}
  }
}

/* === MOCK / DEBUG — run in editor, no webhook ===
// Usage in editor: Run -> testParse, testCmdHelp, testHandleHelp, debugDoPostHelp
// Check View -> Logs (or Executions -> logs) after each run.
// These never touch webhook; they log to spreadsheet 174KDDCM... via logUpdate_ as well.
*/

function mockPrivateMsg_(text, overrides) {
 overrides = overrides || {};
 return {
   message_id: overrides.message_id || 999,
   from: { id: 1790450430, is_bot: false, username: 'YBcode_000', first_name: 'YB' },
   chat: { id: 1790450430, type: 'private' },
   date: Math.floor(Date.now()/1000),
   text: text
 };
}

function testParse() {
 var cases = ['/help', '/help@WickedAICoffesionbot', '/help ', '/HELP', '/start', '/Help foo', '/unknown'];
 for (var i=0;i<cases.length;i++) { var p=parseCommand(cases[i]); console.log('parse['+cases[i]+'] => '+JSON.stringify(p)); }
}

function testCmdHelp() {
 console.log('=== testCmdHelp direct ===');
 try { cmdHelp(mockPrivateMsg_('/help')); console.log('cmdHelp returned ok'); } catch(e){ console.error('cmdHelp threw', e); }
}

function testHandleHelp() {
 console.log('=== testHandleHelp via handleMessage ===');
 try { handleMessage(mockPrivateMsg_('/help')); console.log('handleMessage /help done'); } catch(e){ console.error(e); }
 try { handleMessage(mockPrivateMsg_('/start')); console.log('handleMessage /start done'); } catch(e){ console.error(e); }
}

function testHelpPayload_() {
 // what sendMessage would send for /help
 var lines = ['<b>Available commands</b>\n'];
 for (var i=0;i<COMMANDS.length;i++) lines.push('/'+COMMANDS[i].name+' — '+escapeHtml(COMMANDS[i].description));
 lines.push('\nAdmins can also use /setchannel to configure the channel.');
 var payload = lines.join('\n');
 console.log('help payload len='+payload.length);
 console.log(payload);
 // try parse as HTML validation: log if would fail
 return payload;
}

function debugDoPostHelp() {
 console.log('=== debugDoPostHelp — mock e.postData ===');
 var freshId = 9000000 + Math.floor(Math.random()*1000000);
 console.log('using freshId='+freshId);
 var update = { update_id: freshId, message: mockPrivateMsg_('/help', {message_id: 100}) };
 var e = { postData: { contents: JSON.stringify(update) } };   // no secret → should be unauthorized now
 var res = doPost(e);
 var body = ''; try { body = typeof res.getContent === 'function' ? res.getContent() : (typeof res.getContentText==='function'?res.getContentText(): String(res)); } catch(err){ body='err:'+err; }
 console.log('doPost(no secret) body='+body+' (expect Unauthorized/deny)');
 var eAuth = { postData: { contents: JSON.stringify(update) }, parameter: { secret: 'test-secret' } };  // secret set but property unset → still unauthorized
 var resAuth = doPost(eAuth);
 var bodyAuth=''; try{ bodyAuth = typeof resAuth.getContent==='function'?resAuth.getContent(): (typeof resAuth.getContentText==='function'?resAuth.getContentText(): String(resAuth)); }catch(err){bodyAuth='err:'+err;}
 console.log('doPost(wrong secret) body='+bodyAuth+' (expect Unauthorized/deny unless property is empty)');
 var e2 = { postData: { contents: JSON.stringify(update) }, parameter: { secret: webhookSecret_() } };  // matches property (may be '' if unset) → normal path
 var res2 = doPost(e2);
 var body2=''; try{ body2 = typeof res2.getContent==='function'?res2.getContent(): (typeof res2.getContentText==='function'?res2.getContentText(): String(res2)); }catch(err){body2='err:'+err;}
 console.log('doPost(match secret) body='+body2+' (expect help text / duplicate_ignored)');
 // second identical e2 → should be duplicate_ignored
 var res3 = doPost(e2);
 var body3=''; try{ body3 = typeof res3.getContent==='function'?res3.getContent(): (typeof res3.getContentText==='function'?res3.getContentText(): String(res3)); }catch(err){body3='err:'+err;}
 console.log('doPost(match secret dup) body='+body3+' (expect duplicate_ignored)');
 console.log('=== direct sendMessage payload test ===');
 var payload = testHelpPayload_();
 console.log('payload logged above');
}

function debugAll_() { testParse(); testHelpPayload_(); testHandleHelp(); debugDoPostHelp(); }

/* === DIAGNOSE — run in the editor to find out why the bot is silent ===
// Run -> diagnose, then read View -> Logs (Executions -> logs).
// It only reads: no message is sent to any chat, no property is written.
// Each check prints OK / PROBLEM, and the last line names the first thing to fix.
*/
function diagnose() {
  const out = [];
  function line(status, label, detail) { out.push('[' + status + '] ' + label + (detail ? ' — ' + detail : '')); }
  const props = PropertiesService.getScriptProperties();
  const firstProblem = { v: null };
  function problem(label, detail, fix) {
    line('PROBLEM', label, detail);
    if (!firstProblem.v) firstProblem.v = fix || label;
  }
  function okay(label, detail) { line('OK', label, detail); }

  line('INFO', 'diagnose start', new Date().toISOString());

  // 1. Script properties
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  const rawChannel = props.getProperty('CONFESSION_CHANNEL_ID');
  const rawAuto = props.getProperty('AUTO_REPLY');
  const adminRaw = props.getProperty('ADMIN_IDS');

  if (!token) problem('TELEGRAM_BOT_TOKEN is missing', 'getConfig() throws, so pollTelegram_ dies before it fetches anything', 'Set TELEGRAM_BOT_TOKEN in Script Properties.');
  else okay('TELEGRAM_BOT_TOKEN is set', 'length ' + String(token).length + ', ends ...' + String(token).slice(-4));

  if (!geminiKey) line('WARN', 'GEMINI_API_KEY is missing', 'every comment will be the fallback string');
  else okay('GEMINI_API_KEY is set', 'length ' + String(geminiKey).length);

  if (!rawChannel) problem('CONFESSION_CHANNEL_ID is not set', 'the channel listener cannot match, and /confess says "No channel configured"', 'Set CONFESSION_CHANNEL_ID, or DM the bot /setchannel <id>.');
  else if (!/^-?\d+$/.test(String(rawChannel).trim())) problem('CONFESSION_CHANNEL_ID is not a plain number', 'value is ' + JSON.stringify(String(rawChannel)) + '; getConfig() turns any non-numeric value into null, so the channel is treated as unset', 'Use the numeric id like -1001234567890 (the @name form is rejected here).');
  else okay('CONFESSION_CHANNEL_ID is numeric', String(rawChannel).trim());

  if (rawAuto === null || rawAuto === undefined) problem('AUTO_REPLY is not set', 'the listener is off, so channel posts are ignored silently — this is the default', 'Set AUTO_REPLY to exactly true (lowercase).');
  else if (String(rawAuto).trim().toLowerCase() !== 'true') problem('AUTO_REPLY is set but not to "true"', 'value is ' + JSON.stringify(String(rawAuto)) + '; only the exact string true enables the listener', 'Set AUTO_REPLY to exactly true (lowercase).');
  else okay('AUTO_REPLY is on');

  if (!adminRaw) line('WARN', 'ADMIN_IDS is empty', '/setchannel will refuse everyone');

  // 2. Telegram reachability + identity
  if (token) {
    try {
      const me = JSON.parse(UrlFetchApp.fetch(TELEGRAM_API_BASE_ + '/bot' + token + '/getMe', { muteHttpExceptions: true }).getContentText());
      if (me.ok) okay('Telegram accepts the token', '@' + (me.result && me.result.username));
      else problem('Telegram rejected the token', String(me.error_code) + ' ' + String(me.description), 'The token is wrong or was revoked in BotFather — copy the current token into TELEGRAM_BOT_TOKEN.');
    } catch (e) { problem('getMe threw', String(e)); }
  }

  // 3. Webhook must be OFF — it blocks getUpdates with 409
  if (token) {
    try {
      const info = JSON.parse(UrlFetchApp.fetch(TELEGRAM_API_BASE_ + '/bot' + token + '/getWebhookInfo', { muteHttpExceptions: true }).getContentText());
      const url = info.result && info.result.url;
      if (url) problem('A webhook is still registered', 'url=' + url + '; Telegram refuses getUpdates while a webhook is set (409 Conflict)', 'Run setupPolling() — it calls deleteWebhook() first.');
      else okay('No webhook registered', 'polling can receive updates');
      if (info.result && info.result.pending_update_count) line('INFO', 'pending updates waiting', String(info.result.pending_update_count));
    } catch (e) { problem('getWebhookInfo threw', String(e)); }
  }

  // 4. The polling trigger
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const poll = triggers.filter(function (t) { return t.getHandlerFunction() === 'pollTelegram_'; });
    if (poll.length === 0) problem('No pollTelegram_ trigger exists', 'nothing calls the bot — this alone explains total silence', 'Run setupPolling() in the editor.');
    else if (poll.length > 1) problem('More than one pollTelegram_ trigger', 'found ' + poll.length + '; duplicate triggers cause duplicate replies', 'Run stopPolling() then setupPolling().');
    else okay('Exactly one pollTelegram_ trigger', 'the bot is being called once a minute');
    line('INFO', 'all project triggers', triggers.map(function (t) { return t.getHandlerFunction(); }).join(', ') || '(none)');
  } catch (e) { problem('getProjectTriggers threw', String(e)); }

  // 5. Poll offset sanity
  const offRaw = props.getProperty('POLL_OFFSET');
  if (!offRaw) line('INFO', 'POLL_OFFSET is unset', 'the next poll will start from 0 and drain the queue');
  else okay('POLL_OFFSET is set', offRaw + ' (setupPolling() resets it to 0; a stale offset above the live update ids would make getUpdates return nothing forever, with no error)');

  // 6. Can the bot actually POST to the channel? Read-only check.
  if (token && rawChannel && /^-?\d+$/.test(String(rawChannel).trim())) {
    const ch = String(rawChannel).trim();
    try {
      const chat = JSON.parse(UrlFetchApp.fetch(TELEGRAM_API_BASE_ + '/bot' + token + '/getChat?chat_id=' + encodeURIComponent(ch), { muteHttpExceptions: true }).getContentText());
      if (chat.ok) {
        okay('Channel is reachable', (chat.result && chat.result.title) + ' (' + (chat.result && chat.result.type) + ')');
      } else {
        problem('Cannot read the channel', String(chat.error_code) + ' ' + String(chat.description), 'Check the id, and that the bot is a member of the channel.');
      }
    } catch (e) { problem('getChat threw', String(e)); }

    try {
      const member = JSON.parse(UrlFetchApp.fetch(TELEGRAM_API_BASE_ + '/bot' + token + '/getChatMember?chat_id=' + encodeURIComponent(ch) + '&user_id=' + encodeURIComponent(String((token.split(':')[0]) || '0')), { muteHttpExceptions: true }).getContentText());
      if (member.ok) {
        const st = member.result && member.result.status;
        if (st === 'administrator' || st === 'creator') okay('Bot is an admin in the channel', 'status=' + st);
        else problem('Bot is NOT an admin in the channel', 'status=' + st + '; it cannot post, so every reply fails with 403', 'Add the bot to the channel as an administrator with Post Messages.');
      } else {
        line('WARN', 'Could not read the bot\'s channel membership', String(member.description));
      }
    } catch (e) { line('WARN', 'getChatMember threw', String(e)); }
  }

  // 7. The log sheet, which is the only place the bot records what it did
  try {
    const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    const sh = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sh) line('WARN', 'Log sheet tab "' + LOG_SHEET_NAME + '" does not exist yet', 'it is created on the first write');
    else {
      const last = sh.getLastRow();
      okay('Log sheet reachable', 'rows=' + last);
      if (last > 1) {
        const recent = sh.getRange(Math.max(2, last - 4), 1, Math.min(5, last - 1), 10).getValues();
        for (let i = 0; i < recent.length; i++) {
          line('INFO', 'log row', recent[i][0] + ' | action=' + recent[i][8] + ' | cmd=' + recent[i][7] + ' | err=' + recent[i][9]);
        }
      }
    }
  } catch (e) { line('WARN', 'Could not open the log sheet', String(e)); }

  // 8. What the last run actually did
  line('INFO', 'recent console errors', '(see Executions -> the pollTelegram_ runs)');

  line('INFO', 'diagnose end');
  // The summary must be part of the RETURNED text, not only the log: the return value is
  // what a caller (or a test) reads, and a report that omits its own verdict is how a
  // failing configuration gets mistaken for a clean one.
  out.push(firstProblem.v ? '\n==> FIX THIS FIRST: ' + firstProblem.v : '\n==> No blocking problem found. If the bot is still silent, check Executions for pollTelegram_ runs and whether the deployed file matches Code.gs.');
  const report = out.join('\n');
  console.log(report);
  return report;
}
