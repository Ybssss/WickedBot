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
   5. Deploy -> New deployment -> Web app -> Anyone -> Deploy. Copy URL.
   6. Open editor dropdown -> select 'registerCommands': Run (one-time).
   7. DM bot /start -> should respond. /help -> command list.

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

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN in Script Properties');
  const geminiKey = props.getProperty('GEMINI_API_KEY') || '';
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  const channelId = props.getProperty('CONFESSION_CHANNEL_ID') || null;
  const adminRaw = props.getProperty('ADMIN_IDS') || '';
  const adminIds = new Set(adminRaw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; }).map(Number));
  return { token: token, geminiKey: geminiKey, model: model, channelId: channelId, adminIds: adminIds, version: BOT_VERSION };
}

function getAdminIds() { return getConfig().adminIds; }
function getChannelId() { return getConfig().channelId; }
function setChannelId(id) { PropertiesService.getScriptProperties().setProperty('CONFESSION_CHANNEL_ID', String(id)); }
function isAdmin(userId) { if (userId === null || userId === undefined) return false; return getAdminIds().has(Number(userId)); }

/* --- HTML ESCAPE --- */
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function logToSheet_(row) { try { const ss = SpreadsheetApp.openById(LOG_SHEET_ID); let sh = ss.getSheetByName(LOG_SHEET_NAME); if (!sh) { sh = ss.insertSheet(LOG_SHEET_NAME); sh.appendRow(['timestamp','update_id','chat_id','chat_type','user_id','username','text','parsed_command','action','error','webhook_url']); } sh.appendRow(row); } catch (e) { console.error('logToSheet_:', e); } }
function logUpdate_(update, parsed, action, error) { try { const msg = update.message || update.channel_post || update.edited_message || {}; const chat = msg.chat || {}; const from = msg.from || {}; const text = msg.text || JSON.stringify(update).substring(0,500); const row = [ new Date().toISOString(), update.update_id || '', chat.id || '', chat.type || (update.channel_post ? 'channel' : ''), from.id || '', from.username || '', String(text).substring(0,500), parsed ? parsed.command : '', action || '', error ? String(error).substring(0,500) : '', '' ]; logToSheet_(row); } catch(e){} }

/* --- WEBHOOK & COMMAND REGISTRATION --- */
function setupWebhook() {
  const cfg = getConfig();
  const url = WEBHOOK_URL_;
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/setWebhook?url=' + encodeURIComponent(url) + '&drop_pending_updates=true';
  const resp = UrlFetchApp.fetch(apiUrl, { method: 'get', muteHttpExceptions: false });
  console.log('setupWebhook: code=' + resp.getResponseCode() + ' body=' + resp.getContentText() + ' url=' + url);
  registerCommands();
}

function deleteWebhook() {
  const cfg = getConfig();
  const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/deleteWebhook?drop_pending_updates=true';
  const resp = UrlFetchApp.fetch(apiUrl, { method: 'post', muteHttpExceptions: true });
  console.log('deleteWebhook: ' + resp.getContentText());
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
  for (let i = 0; i < COMMANDS.length; i++) { lines.push('/' + COMMANDS[i].name + ' &mdash; ' + escapeHtml(COMMANDS[i].description)); }
  lines.push('\nAdmins can also use /setchannel to configure the channel.');
  const on = PropertiesService.getScriptProperties().getProperty('AUTO_REPLY') === 'true';
  if (on) lines.push('\nAuto-reply is <b>on</b> &mdash; the bot comments on every new channel post.');
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
  let comment; try { comment = generateComment(text, ''); } catch (e) { console.error('cmdConfess:', e); }
  if (comment && comment.trim().length > 0) {
    if (confId) sendMessage(ch, '<b>Comment:</b>\n\n' + comment, { replyToMessageId: confId });
    else sendMessage(ch, '<b>Comment:</b>\n\n' + comment);
  }
  sendMessage(msg.chat.id, 'Posted anonymously. And I had thoughts.');
}

function cmdReply(msg, args) {
  const raw = (args || '').trim();
  if (!raw) { sendMessage(msg.chat.id, 'Usage: <code>/reply &lt;message_id&gt; [hint]</code>'); return; }
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
  const resp = sendMessage(ch, '<b>Comment on #' + idStr + ':</b>\n\n' + c, { replyToMessageId: Number(idStr) });
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
  return postToChannel(ch, '<b>Comment:</b>\n\n' + comment);
}
function postRoastToChannel(roast) { return postCommentToChannel(roast); }
function postToChannel(channelId, body) {
  const resp = sendMessage(channelId, body);
  return !!(resp && resp.ok === true);
}
function postToChannelWithResult(channelId, body) {
  const resp = sendMessage(channelId, body);
  return resp || null;
}

/* --- WEBHOOK ENTRYPOINT --- */
function doPost(e) {
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
    // channel posts are handled only via AUTO_REPLY listener, not as private commands
    if (update.channel_post || update.edited_channel_post) {
      console.log('doPost: channel_post ignored (no AUTO_REPLY dispatch here)');
      try { logUpdate_(update, null, 'channel_post_ignored', null); } catch(_e){}
      return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
    }
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
    const autoReplyOn = PropertiesService.getScriptProperties().getProperty('AUTO_REPLY') === 'true';
    const chId = getChannelId();
    // Channel listener: opt-in via AUTO_REPLY script property
    if (autoReplyOn && chId && String(msg.chat.id) === String(chId) && msg.text && msg.from && msg.from.is_bot !== true) {
      const trimmed = String(msg.text).trim();
      if (trimmed.charAt(0) !== '/') {
        let c; try { c = generateComment(trimmed, ''); } catch (e) { console.error('listener:', e); }
        if (c && c.trim().length > 0) sendMessage(chId, '<b>Comment:</b>\n\n' + c, { replyToMessageId: msg.message_id });
      }
      return;
    }
    if (msg.chat.type !== 'private') {
      try{ logUpdate_({message: msg}, null, 'non_private_ignored', null);}catch(_e){}
      sendMessage(msg.chat.id, escapeHtml(PRIVATE_ONLY_MESSAGE));
      return;
    }
    const text = (msg.text || '').trim();
    if (text.length === 0) { try{ logUpdate_({message: msg}, null, 'empty_text', null);}catch(_e){} return; }
    if (text.charAt(0) !== '/') {
      try{ logUpdate_({message: msg}, null, 'non_slash_ignored', null);}catch(_e){}
      sendMessage(msg.chat.id, 'Only commands. Type /help.');
      return;
    }
    const parsed = parseCommand(text);
    // log deferred — post-reply to avoid SpreadsheetApp latency before sendMessage (302 retry flood)
    if (!parsed) {
      sendMessage(msg.chat.id, 'Could not parse command. Type /help.');
      try{ logUpdate_({message: msg}, null, 'parse_failed', null);}catch(_e){}
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
