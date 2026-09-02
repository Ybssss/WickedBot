'use strict';

/**
 * @fileoverview Configuration loader for the Roasting Bot.
 *
 * Reads secrets and runtime configuration from `PropertiesService.getScriptProperties()`.
 * All sensitive values (bot tokens, API keys) are expected to be set via
 * File -> Project properties -> Script properties in the Apps Script editor.
 *
 * Do NOT hardcode real keys in this file. Use placeholders or environment
 * overrides only.
 */

/** @const {string} Bot version, exposed via getConfig_().version. */
const BOT_VERSION = '1.0.0';

/**
 * Default Gemini model identifier. `gemini-3.1-flash-lite` is not a publicly
 * released model name; `gemini-2.5-flash-lite` is the current equivalent.
 * Users may override this by setting the `GEMINI_MODEL` script property.
 * @const {string}
 */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

/**
 * Reads all configuration from Script Properties and returns it as a plain
 * object. Missing required values throw a descriptive error so misconfiguration
 * is caught early rather than producing cryptic 4xx/5xx webhook responses.
 *
 * @return {{
 *   token: string,
 *   geminiKey: string,
 *   model: string,
 *   channelId: (string|null),
 *   adminIds: Set<number>,
 *   version: string
 * }}
 * @private
 */
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    throw new Error(
      'Missing TELEGRAM_BOT_TOKEN script property. ' +
      'Set it under File -> Project properties -> Script properties.'
    );
  }
  const geminiKey = props.getProperty('GEMINI_API_KEY') || '';
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  const channelId = props.getProperty('CONFESSION_CHANNEL_ID') || null;
  const adminIds = parseAdminIds_(props.getProperty('ADMIN_IDS'));
  return {
    token: token,
    geminiKey: geminiKey,
    model: model,
    channelId: channelId,
    adminIds: adminIds,
    version: BOT_VERSION
  };
}

/**
 * Returns the set of Telegram numeric user ids that are allowed to invoke
 * admin commands (e.g. `/setchannel`). Returns an empty set if `ADMIN_IDS`
 * is unset or malformed.
 *
 * @return {Set<number>}
 */
function getAdminIds() {
  return getConfig_().adminIds;
}

/**
 * Returns the currently configured Telegram channel id, or `null` if the
 * channel has not been set yet. Channel id can be a numeric id (e.g.
 * `-1001234567890`) for supergroups/channels, or a public `@channelname`.
 *
 * @return {string|null}
 */
function getChannelId() {
  return getConfig_().channelId;
}

/**
 * Persists the Telegram channel id to Script Properties so that subsequent
 * invocations of `getChannelId()` return the updated value. Intended to be
 * called from the admin `/setchannel` command handler.
 *
 * @param {string} id Channel id (numeric string like `-1001234567890` or
 *     public `@channelname`). Empty/null values clear the setting.
 * @return {void}
 */
function setChannelId(id) {
  const props = PropertiesService.getScriptProperties();
  if (id === null || id === undefined || String(id).trim() === '') {
    props.deleteProperty('CONFESSION_CHANNEL_ID');
  } else {
    props.setProperty('CONFESSION_CHANNEL_ID', String(id).trim());
  }
}

/**
 * Parses a comma-separated list of numeric user ids from a script property
 * value into a `Set<number>`. Non-numeric tokens are silently skipped.
 *
 * @param {string|null|undefined} raw Raw `ADMIN_IDS` property value.
 * @return {Set<number>}
 * @private
 */
function parseAdminIds_(raw) {
  const ids = new Set();
  if (!raw) return ids;
  const parts = String(raw).split(',');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (Number.isFinite(n) && Number.isInteger(n)) {
      ids.add(n);
    }
  }
  return ids;
}