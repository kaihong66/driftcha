# Security policy

Driftcha is an **experimental** CAPTCHA. It has not been audited, and no CAPTCHA
stops a determined, well-funded attacker. Read the
[security model](README.md#security-model) before relying on it, and treat it as one
layer of defense, never the only one.

## Supported versions

Only the latest release receives fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## What counts as a vulnerability

Please report privately:

- Ways to learn the answer in **mock-server mode** without solving the visual
  challenge (leaks through the API, the frame stream, timing, tokens, …).
- Forging, replaying or reusing pass tokens, proofs of work or challenges.
- Ways to crash, exhaust or take over the mock server (`server/`).
- Script injection (XSS) through the widget or the demo page.

Please open a **public issue** instead for:

- Anything in **browser-only mode** where the answer is readable from page memory.
  That is documented and expected.
- Automated solvers that read the motion (computer vision, optical flow, ML).
  These are research results rather than secrets, and they help tune the
  difficulty. Sharing them openly is welcome.
- Bypasses of the client-side click and typing checks. They are behavioral
  signals, not security boundaries.

## How to report

Use GitHub's **private vulnerability reporting**: open the repository's
_Security_ tab and choose _Report a vulnerability_. Please include:

- the version or commit,
- the mode (mock server / browser only),
- steps to reproduce or a proof of concept,
- the impact you expect.

You should get a reply within 7 days. Once a fix is released, we are happy to
credit you in the changelog unless you prefer to stay anonymous.
