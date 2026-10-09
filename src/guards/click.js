const PRESS_WINDOW = 1500; // ms from pointerdown to click
const KEY_WINDOW = 1000; // ms from Enter/Space keydown to click
const MIN_MOUSE_PRESS = 30; // ms
const MIN_TOUCH_PRESS = 20; // ms
const MAX_TRAVEL = 80; // px between pointerdown and pointerup
const MIN_APPROACH = 3; // trusted mouse moves while arriving at the button

/**
 * Lets a click through only when it arrives along a plausible human path:
 *  - pointer: trusted pointerdown/up on the button with a sane press duration
 *    and travel; a mouse must also have moved onto the button (no teleporting).
 *  - keyboard: a trusted Enter/Space keydown on the button. Its hold time is
 *    checked later, once the key is likely released (`signals.keyHold`).
 *  - assistive tech: a trusted click with no pointer or key activity, as
 *    fired by screen readers. Only `isTrusted` is checked.
 *
 * `onAttempt({ ok, path, key })` is called for every click while not busy.
 * @returns {() => void} removes the listeners
 */
export function guardClicks(button, { signals, isBusy, onAttempt }) {
  let press = null; // trusted pointer press on this button
  let keyPress = null; // trusted Enter/Space keydown on this button
  let enteredAt = -Infinity;

  const handlers = {
    pointerenter(e) {
      if (e.isTrusted && e.pointerType === 'mouse') enteredAt = e.timeStamp;
    },
    pointerdown(e) {
      if (isBusy() || !e.isTrusted) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press = {
        id: e.pointerId,
        type: e.pointerType,
        x: e.clientX,
        y: e.clientY,
        down: e.timeStamp,
        up: null,
        upX: 0,
        upY: 0,
        approach: e.pointerType === 'mouse' ? signals.movesBetween(enteredAt - 600, e.timeStamp) : -1
      };
    },
    pointerup(e) {
      if (!e.isTrusted || !press || e.pointerId !== press.id) return;
      press.up = e.timeStamp;
      press.upX = e.clientX;
      press.upY = e.clientY;
    },
    pointercancel() {
      press = null;
    },
    keydown(e) {
      if (!e.isTrusted || e.repeat) return;
      if (e.key === 'Enter' || e.key === ' ') keyPress = { key: e.key, down: e.timeStamp };
    },
    click(e) {
      e.preventDefault();
      e.stopPropagation();
      if (isBusy()) return;

      const now = performance.now();
      let path = null;
      let ok = false;

      if (e.isTrusted) {
        if (press && now - press.down < PRESS_WINDOW) {
          path = 'pointer';
          if (press.up != null) {
            const held = press.up - press.down;
            const travel = Math.hypot(press.upX - press.x, press.upY - press.y);
            const mouse = press.type === 'mouse';
            ok =
              held >= (mouse ? MIN_MOUSE_PRESS : MIN_TOUCH_PRESS) &&
              held <= PRESS_WINDOW &&
              travel <= MAX_TRAVEL &&
              (!mouse || press.approach >= MIN_APPROACH);
          }
        } else if (keyPress && now - keyPress.down < KEY_WINDOW) {
          path = 'key';
          ok = true; // hold time is checked after the proof of work
        } else if (e.detail === 0) {
          path = 'assistive';
          ok = true;
        }
      }

      const key = keyPress;
      press = null;
      keyPress = null;
      onAttempt({ ok, path, key });
    }
  };

  const reset = () => {
    press = null;
    keyPress = null;
  };

  for (const [type, handler] of Object.entries(handlers)) button.addEventListener(type, handler);
  window.addEventListener('blur', reset);

  return () => {
    for (const [type, handler] of Object.entries(handlers)) button.removeEventListener(type, handler);
    window.removeEventListener('blur', reset);
  };
}
