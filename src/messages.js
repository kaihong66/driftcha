/**
 * User-facing strings. Override any of them through the `messages` option.
 * `{name}` placeholders are filled in by `format`.
 */
export const DEFAULT_MESSAGES = Object.freeze({
  title: 'Prove you’re human',
  subtitle: 'Read the digits drifting through the noise',
  progressLabel: 'Challenge progress',
  canvasLabel: 'Animated noise. The digits are only visible while they move.',
  inputLabel: 'The digits you see',
  zoomIn: 'Enlarge',
  zoomOut: 'Exit enlarged view',

  verify: 'Verify',
  reload: 'New code',
  busy: 'Checking…',
  passed: '✓ OK',
  failed: 'Failed',

  loading: 'Loading a challenge…',
  prompt: 'Type the {length} digits drifting through the {description} noise.',
  pressVerify: 'Press Verify (or Enter again) to submit.',
  needDigits: 'Type all {length} digits, one at a time.',
  typingRejected: 'That didn’t look typed. Clear the field and type the digits one by one.',
  wrong: 'Not quite — here’s a fresh code.',
  stagePassed: 'Stage {done} cleared. Now the {description} round.',
  clickRejected: 'The click check failed. Please click again.',
  tooFast: 'That was very quick. Take another look, then press Verify again.',
  success: 'Verified. You are (probably) human.',
  expired: 'That code expired. Here’s a fresh one.',
  timedOut: 'This code timed out. Press New code for a fresh one.',
  networkError: 'Connection problem. Try again in a moment.',

  oneAtATime: 'Type one digit at a time.',
  noPaste: 'Type the digits one by one — pasting and dropping are disabled.',
  noAutocorrect: 'Turn off autocorrect and type the digits one by one.',
  plainDigits: 'Switch your keyboard to plain digits and type them one by one.',

  doneTitle: 'Verified',
  doneBody: 'All {count} stages passed.',
  restart: 'Run again',
  errorTitle: 'Can’t reach the server',
  errorBody: 'The verification server didn’t respond.',
  retry: 'Try again'
});

/** Replaces `{key}` placeholders with values from `vars`; unknown keys are left as-is. */
export function format(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}
