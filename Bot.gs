'use strict';

/**
 * @fileoverview Command dispatcher and conversation logic for Roasting Bot.
 *
 * Routing entrypoint is `handleMessage_`, called from `Telegram.gs:doPost`.
 * All command handlers are private (underscore suffix) and take a single
 * Telegram message object.
 *
 * Privacy contract: nothing in this file may include the user's name,
 * username, or numeric id in any message sent to the channel. Channel
 * posts are always fully anonymous.
 */

const PRIVATE_ONLY_MESSAGE_ = 'Please talk to me in a private chat.';

const COMMANDS_ = [
  { name: 'start',     description: 'Show a welcome message.' },
  { name: 'help',      description: 'List all commands.' },
  { name: 'comment',   description: 'Post a topic to the channel with a witty bot comment. Usage: /comment <text>' },
  { name: 'confess',   description: 'Post an anonymous confession; the bot will comment on it. Usage: /confess <message>' },
  { name: 'reply',     description: 'Reply to a channel post with a bot comment. Usage: /reply <message_id> [hint]' },
  { name: 'setchannel', description: 'Admin only. Set the confession channel id. Usage: /setchannel <id>' }
];

/**
 * Routes a single incoming Telegram message to the right command handler.
 *
 * Called from `Telegram.gs:doPost`. Wraps everything in a try/catch so
 * a bug in one handler can't take down the whole webhook.
 *
 * @param {Object} msg A Telegram `Message` object (the `message` field of an
 *     `Update`). Expected fields used here: `chat.id`, `chat.type`,
 *     `from.id`, `text`.
 * @return {void}
 * @private
 */
function handleMessage_(msg) {
  try {
    if (!msg || !msg.chat) {
      console.log('handleMessage_: dropping message with no chat field');
      return;
    }

    // Channel-listener: if the message landed in the configured channel AND
    // AUTO_REPLY is on AND it isn't from the bot itself, auto-reply with
    // a Gemini comment threaded under that post. This is opt-in via
    // the AUTO_REPLY Script Property and runs BEFORE the "private only"
    // check below.
    const autoReplyOn = PropertiesService.getScriptProperties().getProperty('AUTO_REPLY') === 'true';
    const channelId = getChannelId();
    if (
      autoReplyOn &&
      channelId &&
      String(msg.chat.id) === String(channelId) &&
      msg.from && msg.from.is_bot === true
    ) {
      // Skip messages from the bot itself to avoid loops.
      return;
    }
    if (
      autoReplyOn &&
      channelId &&
      String(msg.chat.id) === String(channelId) &&
      msg.text && String(msg.text).trim().length > 0
    ) {
      // Ignore bot commands in the channel — we only comment on free-form
      // posts. Commands still go through the private-chat path below.
      const trimmed = String(msg.text).trim();
      if (trimmed.charAt(0) !== '/') {
        let comment;
        try {
          comment = generateComment(trimmed, '');
        } catch (err) {
          console.error('handleMessage_ channel-listener: generateComment threw:', err);
          return;
        }
        if (comment && typeof comment === 'string' && comment.trim().length > 0) {
          sendMessage(channelId, '\uD83D\uDCAC ' + comment, {
            replyToMessageId: msg.message_id
          });
        }
        return;
      }
    }

    // Group/channel messages are not supported — we don't want to leak
    // comments into shared spaces accidentally.
    if (msg.chat.type !== 'private') {
      sendMessage(msg.chat.id, escapeHtml_(PRIVATE_ONLY_MESSAGE_));
      return;
    }

    const text = (msg.text || '').trim();
    if (text.length === 0) return; // stickers, photos, etc.

    if (text.charAt(0) !== '/') {
      sendMessage(msg.chat.id,
        'I only understand commands. Type /help to see what I can do.');
      return;
    }

    const parsed = parseCommand_(text);
    if (!parsed) {
      sendMessage(msg.chat.id, 'Could not parse that command. Type /help.');
      return;
    }

    switch (parsed.command) {
      case 'start':      return cmdStart_(msg);
      case 'help':       return cmdHelp_(msg);
      case 'comment':    return cmdComment_(msg, parsed.args);
      case 'roast':      return cmdComment_(msg, parsed.args); // legacy alias
      case 'confess':    return cmdConfess_(msg, parsed.args);
      case 'reply':      return cmdReply_(msg, parsed.args);
      case 'setchannel': return cmdSetChannel_(msg, parsed.args);
      default:
        sendMessage(msg.chat.id,
          'Unknown command. Type /help to see what I can do.');
    }
  } catch (err) {
    console.error('handleMessage_: unhandled error:', err);
    try {
      if (msg && msg.chat && msg.chat.id) {
        sendMessage(msg.chat.id,
          'Something went wrong. Try again, or yell at my human.');
      }
    } catch (innerErr) {
      console.error('handleMessage_: failed to send error reply:', innerErr);
    }
  }
}

/**
 * /start — welcome message.
 * @param {Object} msg Telegram message.
 * @return {void}
 * @private
 */
function cmdStart_(msg) {
  const body =
    '\uD83D\uDCAC <b>CommentBot</b>\n\n' +
    'I comment on confessions in the channel.\n\n' +
    'Type /help.';
  sendMessage(msg.chat.id, body);
}

/**
 * /help — list of all commands with short descriptions.
 * @param {Object} msg Telegram message.
 * @return {void}
 * @private
 */
function cmdHelp_(msg) {
  const lines = ['<b>Available commands</b>\n'];
  for (let i = 0; i < COMMANDS_.length; i++) {
    const c = COMMANDS_[i];
    lines.push('/' + c.name + ' — ' + escapeHtml_(c.description));
  }
  lines.push('\nAdmins can also use /setchannel to configure the channel.');
  const autoReplyOn = PropertiesService.getScriptProperties().getProperty('AUTO_REPLY') === 'true';
  if (autoReplyOn) {
    lines.push('\nAuto-reply is <b>on</b> — the bot will comment on every new channel post.');
  }
  sendMessage(msg.chat.id, lines.join('\n'));
}

/**
 * /comment <text> — generate a Gemini comment on the given text, post it
 * to the configured channel as a top-level message, and DM the user a copy
 * so they know what was posted. Anonymous: never includes the user's
 * name or id.
 *
 * `/roast` is kept as a legacy alias routed to the same handler.
 *
 * @param {Object} msg Telegram message.
 * @param {string} args The text after `/comment`, trimmed.
 * @return {void}
 * @private
 */
function cmdComment_(msg, args) {
  if (checkRateLimit_(msg.from.id, 'comment')) {
    sendMessage(msg.chat.id,
      'Slow down, hotshot. Try again in a minute.');
    return;
  }

  const topic = (args || '').trim();
  if (topic.length === 0) {
    sendMessage(msg.chat.id,
      'What should I comment on? Usage: <code>/comment &lt;text&gt;</code>');
    return;
  }

  const channelId = getChannelId();
  if (!channelId) {
    sendMessage(msg.chat.id,
      'No channel configured yet. Run <code>/setchannel</code> first.');
    return;
  }

  let comment;
  try {
    comment = generateComment(topic, '');
  } catch (err) {
    console.error('cmdComment_: generateComment threw:', err);
    sendMessage(msg.chat.id,
      'My brain short-circuited. Try again in a moment.');
    return;
  }

  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    sendMessage(msg.chat.id, 'I came up blank. Try a different topic.');
    return;
  }

  const ok = postCommentToChannel_(comment);
  if (ok) {
    sendMessage(msg.chat.id, 'Posted a comment to the channel.');
  } else {
    sendMessage(msg.chat.id,
      'I could not post to the channel. Check the bot\'s permissions ' +
      'in that channel.');
  }
}

/**
 * Backwards-compatible alias for {@link cmdComment_}. The `/roast` command
 * still routes here so old users don't break.
 * @param {Object} msg Telegram message.
 * @param {string} args The text after `/roast`, trimmed.
 * @return {void}
 * @private
 */
function cmdRoast_(msg, args) {
  return cmdComment_(msg, args);
}

/**
 * /confess <message> — post an anonymous confession to the channel.
 * @param {Object} msg Telegram message.
 * @param {string} args The text after `/confess`, trimmed.
 * @return {void}
 * @private
 */
function cmdConfess_(msg, args) {
  if (checkRateLimit_(msg.from.id, 'confess')) {
    sendMessage(msg.chat.id,
      'Slow down, hotshot. Try again in a minute.');
    return;
  }

  const text = (args || '').trim();
  if (text.length === 0) {
    sendMessage(msg.chat.id,
      'What\'s the confession? Usage: <code>/confess &lt;message&gt;</code>');
    return;
  }

  const channelId = getChannelId();
  if (!channelId) {
    sendMessage(msg.chat.id,
      'No confession channel is configured yet. Ask an admin to set one.');
    return;
  }

  const leadIn = '\uD83D\uDCDD <b>Anonymous confession:</b>\n\n';
  const posted = postToChannelWithResult_(channelId, leadIn + text);
  if (!posted) {
    sendMessage(msg.chat.id,
      'I could not post to the channel. Check the bot\'s permissions ' +
      'in that channel.');
    return;
  }

  // Try to get the message_id of the confession so the bot's comment
  // can be threaded as a reply under it. If we can't, fall back to a
  // top-level comment.
  const confessionMessageId =
    posted && posted.result && posted.result.message_id
      ? posted.result.message_id
      : null;

  let comment;
  try {
    comment = generateComment(text, '');
  } catch (err) {
    console.error('cmdConfess_: generateComment threw:', err);
    comment = null;
  }

  if (comment && typeof comment === 'string' && comment.trim().length > 0) {
    const opts = confessionMessageId ? { replyToMessageId: confessionMessageId } : null;
    if (opts) {
      sendMessage(channelId, '\uD83D\uDCAC ' + comment, opts);
    } else {
      postCommentToChannel_(comment);
    }
  }

  sendMessage(msg.chat.id,
    'Posted anonymously. And I had thoughts.');
}

/**
 * /reply <message_id> [hint] — reply to a specific channel post with a
 * Gemini-generated comment.
 *
 * The Bot API does not expose a way to fetch the text of an existing
 * message (only `forwardMessage`/copy, which would create a visible echo
 * in the channel). So the comment is generated from the message id plus
 * an optional hint. If only the id is provided, the model is told to
 * comment in a generic, witty way referencing the post id. If a hint is
 * provided, the model comments on the hint.
 *
 * The reply is threaded under the target message via
 * `reply_to_message_id`. If the bot can't reach the channel (not a
 * member, no permission, etc.), the user is told.
 *
 * @param {Object} msg Telegram message.
 * @param {string} args The text after `/reply`, trimmed.
 * @return {void}
 * @private
 */
function cmdReply_(msg, args) {
  if (checkRateLimit_(msg.from.id, 'reply')) {
    sendMessage(msg.chat.id,
      'Slow down, hotshot. Try again in a minute.');
    return;
  }

  const channelId = getChannelId();
  if (!channelId) {
    sendMessage(msg.chat.id,
      'No channel configured yet. Run <code>/setchannel</code> first.');
    return;
  }

  const raw = (args || '').trim();
  if (raw.length === 0) {
    sendMessage(msg.chat.id,
      'Reply to what? Usage: <code>/reply &lt;message_id&gt; [hint]</code>');
    return;
  }

  // First whitespace-separated token must be a positive integer.
  const spaceIdx = raw.search(/\s/);
  const idStr = spaceIdx === -1 ? raw : raw.substring(0, spaceIdx);
  const hint = spaceIdx === -1 ? '' : raw.substring(spaceIdx + 1).trim();

  if (!/^\d+$/.test(idStr) || String(Number(idStr)) === '0') {
    sendMessage(msg.chat.id,
      '<code>message_id</code> must be a positive integer. ' +
      'Usage: <code>/reply &lt;message_id&gt; [hint]</code>');
    return;
  }
  const targetMessageId = Number(idStr);

  // We can't fetch the original message text via the Bot API, so we
  // generate from whatever context the user gave us. If they gave a
  // hint, the model comments on that. If not, the model is told to
  // comment "in response to post #<id>" in a generic, witty way.
  const topic = hint || ('in response to post #' + targetMessageId);
  const context = hint
    ? 'The bot is replying to channel message ' + targetMessageId + '.'
    : 'The bot is replying to channel message ' + targetMessageId +
      ' but cannot see the original text. Comment in a generic, witty way about confessions in general.';

  let comment;
  try {
    comment = generateComment(topic, context);
  } catch (err) {
    console.error('cmdReply_: generateComment threw:', err);
    sendMessage(msg.chat.id,
      'My brain short-circuited. Try again in a moment.');
    return;
  }

  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    sendMessage(msg.chat.id, 'I came up blank. Try a different hint.');
    return;
  }

  const resp = sendMessage(channelId, '\uD83D\uDCAC ' + comment, {
    replyToMessageId: targetMessageId
  });

  if (resp && resp.ok === true) {
    sendMessage(msg.chat.id, 'Posted a reply to post #' + targetMessageId + '.');
  } else {
    const desc = (resp && resp.description) ? resp.description : 'unknown error';
    sendMessage(msg.chat.id,
      "I can't see that message. Make sure the bot is in the channel " +
      'and the message still exists. (' + escapeHtml_(desc) + ')');
  }
}

/**
 * /setchannel <id> — admin only. Verifies the bot can post to the
 * channel before persisting the new id, so a typo doesn't silently
 * break things.
 * @param {Object} msg Telegram message.
 * @param {string} args The text after `/setchannel`, trimmed.
 * @return {void}
 * @private
 */
function cmdSetChannel_(msg, args) {
  if (!isAdmin_(msg.from.id)) {
    sendMessage(msg.chat.id, 'Admin only.');
    return;
  }

  const requested = (args || '').trim();
  if (requested.length === 0) {
    const current = getChannelId();
    if (current) {
      sendMessage(msg.chat.id,
        'Current channel: <code>' + escapeHtml_(current) + '</code>');
    } else {
      sendMessage(msg.chat.id,
        'No channel set. Usage: <code>/setchannel &lt;id&gt;</code>');
    }
    return;
  }

  // Verify before persisting. If the test message fails, leave the old
  // value intact.
  const testBody = '\u2705 RoastingBot is now connected. Brace yourselves.';
  const probe = sendMessage(requested, testBody);

  if (!probe || probe.ok !== true) {
    const desc = (probe && probe.description) ? probe.description : 'unknown error';
    sendMessage(msg.chat.id,
      'I could not send to that channel: ' + escapeHtml_(desc) +
      '\n\nMake sure the bot is added to the channel as an admin with ' +
      '"Post messages" permission, and the id is correct.');
    return;
  }

  setChannelId(requested);
  sendMessage(msg.chat.id,
    'Channel set to <code>' + escapeHtml_(requested) + '</code>. ' +
    'Roasts and confessions will land there from now on.');
}

/**
 * Posts a comment to the configured confession channel with the standard
 * anonymous lead-in.
 * @param {string} comment The comment text. Should already be HTML-safe.
 * @return {boolean} true if Telegram accepted the message.
 * @private
 */
function postCommentToChannel_(comment) {
  const channelId = getChannelId();
  if (!channelId) return false;
  const body = '\uD83D\uDCAC ' + comment;
  return postToChannel_(channelId, body);
}

/**
 * Backwards-compatible alias for {@link postCommentToChannel_}.
 * @param {string} roast Unused; kept for legacy callers.
 * @return {boolean}
 * @private
 */
function postRoastToChannel_(roast) {
  return postCommentToChannel_(roast);
}

/**
 * Sends an arbitrary message to the channel and returns the full Telegram
 * response (so callers can read `result.message_id`). Returns null on
 * network error or non-2xx.
 * @param {string} channelId The channel id.
 * @param {string} body The full message body, including any HTML.
 * @return {Object|null} The parsed Telegram response, or null on failure.
 * @private
 */
function postToChannelWithResult_(channelId, body) {
  const resp = sendMessage(channelId, body);
  if (!resp || resp.ok !== true) return null;
  return resp;
}

/**
 * Sends an arbitrary message to the channel and returns whether it
 * succeeded. Used by both roast and confess paths.
 * @param {string} channelId The channel id.
 * @param {string} body The full message body, including any HTML.
 * @return {boolean} true on `ok: true` from Telegram, false otherwise.
 * @private
 */
function postToChannel_(channelId, body) {
  const resp = sendMessage(channelId, body);
  return !!(resp && resp.ok === true);
}

/**
 * Returns true if the given user id is in the admin set.
 * @param {number|string} userId Telegram numeric user id.
 * @return {boolean}
 * @private
 */
function isAdmin_(userId) {
  if (userId === null || userId === undefined) return false;
  const id = Number(userId);
  if (!isFinite(id)) return false;
  return getAdminIds().has(id);
}

/**
 * Per-user rate limit: at most 5 roast/confess requests per 60 seconds.
 *
 * Uses `CacheService.getScriptCache()` with a key like
 * `rl_<userId>_<bucket>` where `bucket` is a floor of `Date.now() / 60000`.
 * Cache is not perfectly consistent across executions but is good enough
 * for a best-effort rate limit.
 *
 * @param {number|string} userId Telegram user id.
 * @param {string} command Either 'roast' or 'confess'. Mixed into the key
 *     so the limits are independent per command type.
 * @return {boolean} true if the request should be rejected (over limit).
 * @private
 */
function checkRateLimit_(userId, command) {
  if (userId === null || userId === undefined) return false;
  const bucket = Math.floor(Date.now() / 60000);
  const key = 'rl_' + String(userId) + '_' + command + '_' + bucket;
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= 5) return true;

  // Cache expires after at most ~10 minutes; storing with a slightly
  // longer TTL than the bucket window is fine — we just want the counter
  // gone before the next bucket overlaps.
  cache.put(key, String(count + 1), 70);
  return false;
}

/**
 * Parses a command string into its name and argument tail.
 *
 * Strips a trailing bot username suffix from the command name, e.g.
 * `/roast@MyBot foo` -> { command: 'roast', args: 'foo' }. Also lowercases
 * the command name.
 *
 * @param {string} text The raw message text, already trimmed.
 * @return {{command: string, args: string}|null} null if the text does
 *     not look like a command.
 * @private
 */
function parseCommand_(text) {
  if (!text || text.charAt(0) !== '/') return null;
  // Drop the leading slash and split on first whitespace.
  const body = text.substring(1);
  const spaceIdx = body.search(/\s/);
  let head, tail;
  if (spaceIdx === -1) {
    head = body;
    tail = '';
  } else {
    head = body.substring(0, spaceIdx);
    tail = body.substring(spaceIdx + 1);
  }
  // Strip the @botname suffix if present.
  const atIdx = head.indexOf('@');
  if (atIdx !== -1) head = head.substring(0, atIdx);
  head = head.toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return null;
  return { command: head, args: tail.trim() };
}
