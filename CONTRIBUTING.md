# Contributing to Driftcha

Thanks for your interest! Bug reports, solver experiments, difficulty tuning,
accessibility ideas and code are all welcome.

## Getting started

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

The dev server includes the mock API, and the demo page can switch between
"Mock server" and "Browser only".

## Before opening a pull request

```bash
npm run lint
npm run format:check   # or `npm run format` to fix
npm run typecheck
npm test
npm run build
```

CI runs the same commands.

## Guidelines

- **No runtime dependencies.** The widget and the mock server use only web
  platform and Node.js built-ins. Dev dependencies are fine.
- **Keep the engine DOM-free.** `src/core/scene.js`, `plates.js`, `layer.js`,
  `vector-glyphs.js`, `codec.js` and `src/pow/` must run on Node.js; the server
  imports them.
- **Don't break the statistics.** Digits and background must keep sharing dot
  speed, lifetime, color distribution and direction statistics. If you change the
  motion model, explain in the PR why no single-frame or per-pixel statistic gives
  the digits away.
- **Test what you change.** Tests use `node:test` and live in `test/`. Server
  changes should extend `test/api.test.js`.
- **Update the docs.** User-visible changes go in `CHANGELOG.md` under
  _Unreleased_, and in the README if they change usage.
- **Keep commits focused**, with a clear message.

## Reporting security issues

Please don't open public issues for vulnerabilities in mock-server mode. See
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
