# Changelog

All notable changes to this project are documented here.

## 0.2.1 — 2026-10-31

First public GitHub release.

### Added

- Session-scoped, manually armed quiet mode for direct child subagents.
- QueueDock delivery: child messages are deferred to the next turn instead of steering into the running main turn.
- One bubble per child by default; settled completion refreshes the same bubble.
- `coalesce` / `always` / `never` settled-delivery modes.
- `delivered` / `replied` auto-off timing.
- Plugins-page settings card for enabling, delivery, language, TTL, and debug options.
- Optional JSONL event logging for local debugging.
- English and Simplified Chinese documentation.
