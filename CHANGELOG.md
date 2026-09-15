# Changelog

## [Unreleased]

### Fixed

- Channel auto-reply never fired. `pollTelegram_` read `channel_post.from.is_bot`, but
  Telegram does not send `from` on channel posts, so it threw and the error was swallowed.
  Channel posts now route through `handleMessage`, the single place with a correct guard.
- `/help` printed a literal `&mdash;` when auto-reply was on. Telegram's HTML mode only
  decodes `&lt;`, `&gt;`, `&amp;` and `&quot;`.
- `stopPolling()` re-armed the webhook, which is known-broken on Apps Script. It now only
  removes the polling trigger.

### Changed

- `/reply` is rate-limited to 5 per minute per user, matching `/comment` and `/confess`.
- Removed the unused `USE_POLLING_` constant.
- README rewritten: polling replaces the webhook instructions, single-file layout, current
  command set, full Script Properties reference.

## [1.0.0] - 2026-09-02

- Initial release
