'use strict';

/**
 * @fileoverview Low-level Telegram Bot API helpers and GAS webhook entrypoint.
 *
 * Pure functions: no module-level state. All state lives in Config.gs
 * (Script Properties) and Bot.gs (command handlers). This file is the
 * transport layer.
 *
 * The webhook entrypoint is intentionally tiny: it must return 200 to
 * Telegram quickly. Parse, dispatch, return.
 */

const TELEGRAM_API_BASE_ = 'https://api.telegram.org';
const TELEGRAM_MAX_MESSAGE_LENGTH_ = 4096;
const TELEGRAM_SAFE_CHUNK_LENGTH_ = 4000;

/**
 * GAS webhook entrypoint. Telegram POSTs every incoming update here.
 *
 * Goals:
 *   - Always return 200 (with JSON body) so Telegram does not retry-storm
 *     us on bad payloads.
 *   - Dispatch synchronously to `handleMessage_` (Apps Script has no real
 *     async; this is as good as it gets).
 *
 * @param {GoogleAppsScript.Events.DoPost} e The POST event from Apps Script.
 * @return {GoogleAppsScript.Content.TextOutput} A 200 JSON response.
 */
function doPost(e) {
  let update;
  try {
    update = JSON.parse(e.postData.contents);
  } catch (err) {
    console.error('doPost: failed to parse update JSON:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'bad_json' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if (update.message) {
      handleMessage_(update.message);
    } else if (update.edited_message) {
      // For this bot we ignore edits. Could be wired up later.
      console.log('doPost: ignoring edited_message');
    } else if (update.callback_query) {
      // No inline keyboards yet. Acknowledge to suppress Telegram retries.
      console.log('doPost: ignoring callback_query');
    } else {
      console.log('doPost: unknown update shape, keys=' +
        Object.keys(update).join(','));
    }
  } catch (err) {
    console.error('doPost: handler threw:', err);
    // Swallow: still 200 to Telegram. Bot.gs has its own per-message try/catch
    // so this is a belt-and-suspenders last resort.
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Registers the current web app URL as the bot's webhook with Telegram.
 *
 * **Must be run once from the Apps Script editor** after each redeploy,
 * because the web app URL can change. To run: select `setupWebhook` in
 * the function dropdown and click Run.
 *
 * Failures are loud: we `console.error` AND rethrow so the user sees
 * both the stack trace in the Executions log and a red banner in the
 * editor run panel.
 *
 * @return {void}
 */
function setupWebhook() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error(
      'setupWebhook: ScriptApp.getService().getUrl() returned empty. ' +
      'Has the web app been deployed? (Deploy -> New deployment -> Web app)'
    );
  }

  const cfg = getConfig_();
  const apiUrl =
    TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/setWebhook' +
    '?url=' + encodeURIComponent(url) +
    '&drop_pending_updates=true';

  console.log('setupWebhook: POST ' + apiUrl.replace(cfg.token, 'bot<REDACTED>'));

  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'get',
      muteHttpExceptions: false,
      followRedirects: true
    });
    console.log('setupWebhook: response code=' + response.getResponseCode() +
      ' body=' + response.getContentText());
  } catch (err) {
    console.error('setupWebhook: failed:', err);
    throw err;
  }
}

/**
 * Removes the bot's webhook. Convenience for development — after calling
 * this, you can poll Telegram with getUpdates again. Idempotent.
 *
 * @return {void}
 */
function deleteWebhook() {
  const cfg = getConfig_();
  const apiUrl =
    TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/deleteWebhook' +
    '?drop_pending_updates=true';

  const response = UrlFetchApp.fetch(apiUrl, {
    method: 'post',
    muteHttpExceptions: true
  });

  console.log('deleteWebhook: code=' + response.getResponseCode() +
    ' body=' + response.getContentText());
}

/**
 * Sends a text message to a Telegram chat.
 *
 * - Uses HTML parse mode and disables link previews by default.
 * - If `text` exceeds the 4096-char Telegram limit, splits on newlines into
 *   chunks of at most ~4000 chars and sends each. Order is preserved.
 * - All user-supplied text passed in `text` or `opts` should be pre-escaped
 *   via `escapeHtml_` to avoid Telegram parse errors. This function does
 *   not auto-escape because some callers may want to include intentional
 *   HTML (e.g. `<b>`).
 *
 * @param {string|number} chatId The target chat id (user, group, or channel).
 * @param {string} text The message text. May contain HTML.
 * @param {Object=} opts Extra fields merged into the request body, e.g.
 *     `{ reply_markup: {...} }`. To reply to a specific message, pass
 *     `{ replyToMessageId: 123 }` — it will be sent as Telegram's
 *     `reply_to_message_id` on the FIRST chunk only. Telegram only
 *     honors `reply_to_message_id` on a single message, so subsequent
 *     chunks are sent as standalone messages.
 * @return {Object} Parsed JSON response from Telegram, or the last chunk's
 *     response when the message was split.
 */
function sendMessage(chatId, text, opts) {
  if (text === null || text === undefined) {
    throw new Error('sendMessage: text is required');
  }

  // Pull reply_to_message_id out of opts so it can be applied to the first
  // chunk only (Telegram rejects it on any chunk after the first).
  const replyToMessageId = (opts && opts.replyToMessageId !== undefined && opts.replyToMessageId !== null)
    ? opts.replyToMessageId
    : undefined;
  const baseOpts = opts ? Object.assign({}, opts) : {};
  delete baseOpts.replyToMessageId;

  const chunks = chunkText_(String(text), TELEGRAM_SAFE_CHUNK_LENGTH_);
  let lastResponse = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunkBody = Object.assign({
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, baseOpts);
    if (i === 0 && replyToMessageId !== undefined) {
      chunkBody.reply_to_message_id = replyToMessageId;
    }
    const body = chunkBody;

    const cfg = getConfig_();
    const apiUrl = TELEGRAM_API_BASE_ + '/bot' + cfg.token + '/sendMessage';

    let response;
    try {
      response = UrlFetchApp.fetch(apiUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
    } catch (err) {
      console.error('sendMessage: network error to chat=' + chatId +
        ' chunk=' + (i + 1) + '/' + chunks.length + ':', err);
      throw err;
    }

    const code = response.getResponseCode();
    const raw = response.getContentText();

    if (code < 200 || code >= 300) {
      console.error('sendMessage: HTTP ' + code + ' chat=' + chatId +
        ' chunk=' + (i + 1) + '/' + chunks.length + ' body=' + raw);
    }

    try {
      lastResponse = JSON.parse(raw);
      if (!lastResponse.ok) {
        console.error('sendMessage: Telegram returned ok=false chat=' + chatId +
          ' description=' + (lastResponse.description || '(none)'));
      }
    } catch (parseErr) {
      console.error('sendMessage: failed to parse Telegram response:',
        parseErr, 'raw=', raw);
      lastResponse = { ok: false, raw: raw };
    }
  }

  return lastResponse;
}

/**
 * Escapes a string for safe inclusion inside a Telegram HTML message.
 *
 * Escapes: `&`, `<`, `>`, `"`. Does NOT escape `'`, since single quotes are
 * harmless inside HTML tag attributes in Telegram's parser.
 *
 * @param {*} s The value to escape. Non-strings are coerced via String().
 * @return {string} The escaped string. Returns '' for null/undefined.
 * @private
 */
function escapeHtml_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Splits a long string into chunks, preferring newline boundaries.
 *
 * If the input is shorter than `maxLen`, returns it as a single-element
 * array. Otherwise walks the string, cutting at the last newline before
 * `maxLen`, falling back to a hard cut if no newline is found.
 *
 * @param {string} text The text to split.
 * @param {number} maxLen Maximum chunk length. Caller passes a value safely
 *     below Telegram's 4096 limit.
 * @return {string[]} One or more chunks, in order.
 * @private
 */
function chunkText_(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to cut at the last newline within the window.
    const window = remaining.substring(0, maxLen);
    const lastNl = window.lastIndexOf('\n');
    const cutAt = lastNl > 0 ? lastNl : maxLen;

    chunks.push(remaining.substring(0, cutAt));
    // Skip the newline itself at the boundary to avoid leading blank lines.
    remaining = remaining.substring(cutAt).replace(/^\n/, '');
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
