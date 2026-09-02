'use strict';

/**
 * @fileoverview Gemini API integration for the comment bot.
 *
 * Public surface: {@link generateComment}. Everything else is private.
 * Config (api key, model) is read via getConfig_() from Config.gs.
 *
 * `generateRoast` is kept as a thin alias for backwards compatibility with
 * any callers that still use the old name.
 */

var GEMINI_API_BASE_ = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Generate a short, witty comment on the given topic using the Gemini API.
 *
 * On any error (network, auth, parse, missing fields) returns a safe
 * fallback string so the bot never crashes the webhook handler.
 *
 * @param {string} topic - The topic or text to comment on (max 500 chars; will be truncated).
 * @param {string} [context] - Optional extra context (e.g. the original message or a hint). Max 500 chars.
 * @returns {string} The comment text, max 800 chars. Falls back to a safe static comment on any API error.
 */
function generateComment(topic, context) {
  var fallback = 'I had nothing to say for once.';

  if (!topic || typeof topic !== 'string') {
    return fallback;
  }

  var config = getConfig_();
  if (!config || !config.geminiKey || !config.model) {
    console.error('Gemini.gs: missing config.geminiKey or config.model');
    return fallback;
  }

  var safeTopic = truncate_(topic, 500);
  var safeContext = truncate_(context || 'none', 500);

  var url = GEMINI_API_BASE_ + '/' + encodeURIComponent(config.model) +
            ':generateContent?key=' + encodeURIComponent(config.geminiKey);

  var systemPrompt =
    'You are an anonymous, witty participant in a college-style confession channel. ' +
    'Someone just posted or asked about a topic, and you are leaving a short comment in the thread ' +
    '— the kind of comment a sharp, friendly classmate would leave. ' +
    'Write ONE short comment (1-3 sentences, max 800 characters). ' +
    'Be casual, specific when given context, and clever. A little self-aware humor is welcome. ' +
    'Mild snark is OK; cruelty is not. ' +
    'Do NOT use slurs, threats, or anything targeting protected characteristics. ' +
    'Do NOT use markdown. Just plain text. ' +
    'No preamble, no "Here\'s my comment:" — just the comment itself.';

  var userPayload = 'Topic: ' + safeTopic + '\nContext: ' + safeContext;

  var body = {
    contents: [{
      parts: [{
        text: systemPrompt + '\n\n' + userPayload
      }]
    }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 400,
      topP: 0.95
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (err) {
    console.error('Gemini.gs: fetch threw: ' + (err && err.message ? err.message : err));
    return fallback;
  }

  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    console.error('Gemini.gs: non-2xx response ' + code + ' — body: ' + truncate_(response.getContentText(), 500));
    return fallback;
  }

  return parseRoast_(response.getContentText(), fallback);
}

/**
 * Backwards-compatible alias for {@link generateComment}.
 *
 * Older code may still call `generateRoast(target, context)`. Routes to
 * the renamed `generateComment` so nothing breaks. New callers should
 * prefer `generateComment` directly.
 *
 * @param {string} target - The person, name, or text to comment on.
 * @param {string} [context] - Optional extra context.
 * @returns {string} The comment text, max 800 chars.
 */
function generateRoast(target, context) {
  return generateComment(target, context);
}

/**
 * Parse a Gemini generateContent response JSON string and extract the comment text.
 * @private
 * @param {string} raw - Raw response body.
 * @param {string} fallback - Fallback string to return on any parse issue.
 * @returns {string} Extracted text, truncated to 800 chars.
 */
function parseRoast_(raw, fallback) {
  var json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('Gemini.gs: JSON parse failed: ' + err.message);
    return truncate_(fallback, 800);
  }

  var candidate = json && json.candidates && json.candidates[0];
  var parts = candidate && candidate.content && candidate.content.parts;
  var text = parts && parts[0] && parts[0].text;

  if (typeof text !== 'string' || text.length === 0) {
    return truncate_(fallback, 800);
  }

  return truncate_(text, 800);
}

/**
 * Truncate a string to at most `max` characters. Returns input unchanged
 * if it already fits. Treats null/undefined as empty string.
 * @private
 * @param {string} value - Input string.
 * @param {number} max - Maximum length in characters.
 * @returns {string} Truncated string.
 */
function truncate_(value, max) {
  if (value === null || value === undefined) {
    return '';
  }
  var s = String(value);
  if (s.length <= max) {
    return s;
  }
  return s.substring(0, max);
}
