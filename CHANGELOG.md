# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- Digits are no longer distorted by default (`distortion: 0`): upright, no shear or
  wave warp. In testing, full distortion only tripped weak OCR engines (and simple
  post-processing undoes that), while strong OCR and vision-language models read it
  fine; it mostly made the digits harder for people.

### Security

- Mock server speed bumps. They slow bots down rather than stop them:
  - Minimum solve time (`minSolveTime`, default 4 s): an answer sent sooner after the
    challenge's first streamed frame, or before any frame, is refused unread with the
    new result `early`. The challenge stays live; the widget asks the person to look
    again and press Verify (`tooFast` message).
  - Per-IP rate limits (`rateLimit`, default 20 verify / reload requests and 10 new
    sessions per minute), answered with HTTP 429 and `Retry-After`. `clientIp` picks the
    address to count, for use behind a reverse proxy.
  - Proof-of-work difficulty climbs faster: +2 bits per wrong answer and +1 per reload
    (`bitsPerWrong`, `bitsPerReload`), capped at +8 instead of +3. The server now counts
    penalties per client IP instead of per session, so starting a new session no longer
    resets them.
- Documented a block-matching attack on the frame stream: with the default motion
  settings the digits come out cleanly in a few seconds. Settings that defeat it
  (`noise`, `jitter`, short dot lives) also make the digits unreadable for people, so
  the README now describes Driftcha as a speed bump rather than a defense. See
  "Measured: how easily can the digits be cut out?" in the README.

### Added

- `noise` and `jitter` stage parameters (default 0): one-frame random dots and
  per-frame one-pixel wobble, applied to digits and background alike.
- Lab page (`/lab/` on the dev server) to try motion settings live and tally your own
  reading accuracy per setting.
- `onFrame` inspection hook on `createApi()` and `decodeFrame()` in the codec, for
  testing tools.
- `distortion` stage parameter (0–1) scaling digit rotation, squash, shear, italics and
  wave warp, for anyone who wants it back.
- `npm run glyph-samples`: exports clean digit images at any distortion level, with an
  answer key, for testing OCR and vision-language models.
- Enlarge button on the noise canvas: shows the whole widget, code field included, in a
  large modal view. Esc, the backdrop or the shrink button closes it.
- `--dc-max-width` and `--dc-zoom-max-width` CSS properties. The default widget width
  grew from 560 px to 640 px.
- `npm run demo:gif`: renders an animated GIF of the noise field (used in the README).
- TypeScript declarations for the widget, backends and mock server.
- ESLint and Prettier configuration; CI now runs lint, format check and type check.
- `SECURITY.md`, `CONTRIBUTING.md`, issue and pull request templates.
- SVG logo, a simplified favicon for small sizes, and a GitHub social preview image.
- Demo page: "How it works" now shows three live figures (one frozen frame, the noise
  in motion, and the motion tinted by direction), a defenses list and a comparison
  table of the two modes.

## 0.2.0 - 2026-10-09

### Added

- Mock server (`server/api.js`): picks the code, renders the noise and streams frames,
  checks answers and single-use proofs of work, and signs pass tokens verifiable through
  `POST /api/siteverify`. Mounted on `npm run dev` / `npm run preview`, or standalone via
  `npm run serve`.
- Pluggable backends: `createServerBackend()` and `createLocalBackend()`.
- DOM-free noise engine and vector digit glyphs, so the scene runs on Node.js.
- Binary frame stream format (1 bit per pixel for the mono round, RGB332 for color).
- Loading spinner and an error screen with retry.
- Demo page switch between "Mock server" and "Browser only".

## 0.1.0 - 2026-10-08

### Added

- First public version, split out of a single-file prototype (v11) into modules.
- Two rounds (black-and-white, then color) of motion-defined digits in noise.
- Digit "1" drawn as a single vertical stroke so it can't be mistaken for "7".
- Proof of work in a Web Worker with a main-thread fallback.
- Click and typing integrity checks.
- Redesigned UI with code slots, round indicator, success screen, light and dark themes.
