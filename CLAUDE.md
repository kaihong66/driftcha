# Driftcha

A motion-defined noise CAPTCHA: a zero-dependency browser widget (`src/`) and a
reference mock server (`server/api.js`). Commands, coding guidelines and the
pre-PR checklist live in CONTRIBUTING.md:

@CONTRIBUTING.md

## Changing the API surface

The local and server backends share one outcome contract (`wrong`, `next`,
`solved`, `reloaded`, `expired`, `rejected`, `early`; see the comment at the top of
`src/backends/local.js`). A new result, option or message usually touches all of:

- `src/backends/local.js` and/or `server/api.js` (plus `src/backends/server.js` if
  the wire format changes)
- `src/driftcha.js` `handle()` for a new result, `src/messages.js` for new strings
- the hand-written types `src/index.d.ts` and `server/api.d.ts`, and
  `test-d/usage.ts` (compiled by `npm run typecheck`)
- the README tables (widget options, endpoints, `createApi` options) and
  CHANGELOG.md under _Unreleased_

## Easy to get wrong

- **Don't overstate security.** The docs call Driftcha a speed bump, not a defense:
  with default settings a simple motion probe reads the digits (README, "Measured").
  Keep that framing in docs, comments and commit messages.
- **The inspection hooks leak answers.** `onChallenge` and `onFrame` on `createApi()`
  expose codes and digit positions. Use them in tests and tooling only.
- **`redteam/` and `glyph-samples/` are gitignored on purpose.** Don't link to them
  from the README or anything else that gets published.
- **The browser guards reject automation.** `src/guards/` needs real pointer travel
  onto buttons and real key hold times, so a driven browser can't click through the
  widget. Check server behaviour through the API (`fetch` plus `solvePow` from
  `src/pow/pow.js`) and UI handling by calling the widget's `handle()` directly.
- **API test setup.** The shared server in `test/api.test.js` turns off
  `minSolveTime` and rate limits; each speed bump gets its own server via
  `serve(options)`. Limits and PoW penalties are per client IP, so those tests pass
  `clientIp` reading an `x-test-ip` header.
