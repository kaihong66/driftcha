const KEY_WINDOW = 1000; // ms a trusted keydown stays valid for the insert it produces
const EDIT_WINDOW = 300; // ms allowed between beforeinput and its input event

/** Common prefix/suffix diff: where `a` and `b` differ, how much was removed, what was inserted. */
export function diffOf(a, b) {
  let p = 0;
  const m = Math.min(a.length, b.length);
  while (p < m && a[p] === b[p]) p++;
  let q = 0;
  while (q < m - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { p, removed: a.length - p - q, inserted: b.slice(p, b.length - q) };
}

const spread = list => Math.max(...list) - Math.min(...list);

/**
 * Accepts only single digits inserted by trusted `beforeinput` + `input`
 * pairs and keeps its own shadow copy of the value. Setting `.value` from
 * script or dispatching synthetic events never reaches the shadow copy, so the
 * two disagree and the input is rejected at verify time.
 *
 * Each digit must also match a trusted keydown (the same digit key on a
 * physical keyboard; 'Unidentified' / 229 on virtual keyboards), and the
 * typing rhythm and key hold times are sanity-checked.
 *
 * Paste, drop and autocorrect are blocked without locking the field: clear it
 * and type again.
 */
export class TypingGuard {
  constructor(input, { length, signals, messages, onMessage, onChange, onSubmit }) {
    this.input = input;
    this.length = length;
    this.signals = signals;
    this.messages = messages;
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.onSubmit = onSubmit;

    this.typed = []; // [{ ch, t, keyOK, down, hold }]
    this.pending = null; // edit announced by the last trusted beforeinput
    this.lastKey = null; // { key, kc, t } of the last trusted keydown
    this.composition = null; // IME composition in progress
    this.awaitingUp = new Map(); // physical key -> digit entry waiting for its keyup
    this.timers = new Set();
    this.cleanups = [];

    const listen = (type, handler) => {
      input.addEventListener(type, handler);
      this.cleanups.push(() => input.removeEventListener(type, handler));
    };
    listen('keydown', e => this.handleKeyDown(e));
    listen('keyup', e => this.handleKeyUp(e));
    listen('beforeinput', e => this.handleBeforeInput(e));
    listen('input', e => this.handleInput(e));
    listen('compositionstart', e => this.handleCompositionStart(e));
    listen('compositionend', e => this.handleCompositionEnd(e));
    listen('paste', e => {
      e.preventDefault();
      this.say('noPaste');
    });
    listen('drop', e => {
      e.preventDefault();
      this.say('noPaste');
    });
  }

  /** The digits typed so far, according to the shadow copy. */
  get value() {
    return this.typed.map(d => d.ch).join('');
  }

  /** Whether the visible field still matches the shadow copy. */
  get synced() {
    return this.input.value === this.value;
  }

  clear() {
    this.typed = [];
    this.pending = null;
    this.lastKey = null;
    this.composition = null;
    this.awaitingUp.clear();
    this.input.value = '';
    this.onChange?.();
  }

  /** Every digit matched a trusted key and the rhythm looks human. */
  looksHuman() {
    return this.typed.every(d => d.keyOK) && this.rhythmLooksHuman();
  }

  dispose() {
    for (const off of this.cleanups.splice(0)) off();
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  say(key) {
    this.onMessage?.(this.messages[key]);
  }

  /** Puts the shadow copy back into the field. */
  sync() {
    const s = this.value;
    if (this.input.value !== s) {
      this.input.value = s;
      try {
        this.input.setSelectionRange(s.length, s.length);
      } catch {
        /* not focusable */
      }
    }
    this.onChange?.();
  }

  keyMatches(ch, now) {
    const k = this.lastKey;
    if (!k || now - k.t > KEY_WINDOW) return false;
    return k.key === ch || k.key === 'Unidentified' || k.key === 'Process' || k.kc === 229;
  }

  rhythmLooksHuman() {
    const times = this.typed.map(d => d.t).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    if (gaps.some(g => g < 25)) return false; // faster than a person types
    const gapSpread = gaps.length >= 3 ? spread(gaps) : Infinity;
    if (gapSpread < 4) return false; // perfectly even rhythm

    // Physical keyboards: check how long each digit key was held down.
    // (Virtual keyboards fire down/up almost together, so touch is exempt.)
    if (this.signals.pointerType !== 'touch') {
      const holds = this.typed.filter(d => d.hold != null).map(d => d.hold);
      if (holds.length >= 3) {
        if (holds.filter(h => h < 12).length >= 3) return false; // barely held: scripted keys
        // Gaps *and* holds both uniform to a few ms: a fixed-delay script.
        if (gapSpread < 12 && spread(holds) < 8) return false;
      }
    }
    return true;
  }

  handleKeyDown(e) {
    if (!e.isTrusted || e.isComposing) return;
    if (e.key === 'Enter') {
      // Enter never submits directly; focus moves to Verify, which runs the click check.
      e.preventDefault();
      this.onSubmit?.();
      return;
    }
    this.lastKey = { key: e.key, kc: e.keyCode, t: e.timeStamp };
  }

  handleKeyUp(e) {
    if (!e.isTrusted) return;
    const entry = this.awaitingUp.get(e.key);
    if (entry) {
      entry.hold = e.timeStamp - entry.down;
      this.awaitingUp.delete(e.key);
    }
  }

  handleBeforeInput(e) {
    if (!e.isTrusted) return; // synthetic events never change the value; ignore them
    const input = this.input;
    if (input.readOnly) {
      e.preventDefault();
      return;
    }

    const type = e.inputType || '';
    const now = e.timeStamp;

    if (type === 'insertText') {
      const data = e.data ?? '';
      if (data.length !== 1) {
        e.preventDefault();
        this.say('oneAtATime');
        return;
      }
      if (!/^[0-9]$/.test(data)) {
        e.preventDefault();
        return;
      }
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (this.typed.length - (end - start) >= this.length) {
        e.preventDefault();
        return;
      }
      const k = this.lastKey;
      const physical = !!k && k.key === data && now - k.t < KEY_WINDOW;
      this.pending = {
        kind: 'insert',
        ch: data,
        t: now,
        keyOK: this.keyMatches(data, now),
        down: physical ? k.t : null
      };
      this.lastKey = null;
      return;
    }

    if (type.startsWith('delete')) {
      this.pending = { kind: 'delete', t: now };
      return;
    }

    if (
      type === 'insertCompositionText' ||
      type === 'deleteCompositionText' ||
      type === 'insertFromComposition'
    ) {
      return; // not cancelable; settled in compositionend
    }

    // Paste, drop, autocorrect, undo/redo, …: block without locking the field.
    e.preventDefault();
    if (/Paste|Drop|Yank/.test(type)) this.say('noPaste');
    else if (type === 'insertReplacementText') this.say('noAutocorrect');
  }

  handleInput(e) {
    if (this.composition || e.isComposing) return;

    const edit = this.pending;
    this.pending = null;

    if (!e.isTrusted || !edit || performance.now() - edit.t > EDIT_WINDOW) {
      this.sync(); // unexplained change: restore the shadow copy
      return;
    }

    const d = diffOf(this.value, this.input.value);
    if (edit.kind === 'insert' && d.inserted === edit.ch) {
      const entry = { ch: edit.ch, t: edit.t, keyOK: edit.keyOK, down: edit.down, hold: null };
      this.typed.splice(d.p, d.removed, entry);
      if (edit.down != null) this.awaitingUp.set(edit.ch, entry);
    } else if (edit.kind === 'delete' && d.inserted === '') {
      this.typed.splice(d.p, d.removed);
    }
    this.sync();
  }

  // Mobile keyboards sometimes commit digits through composition. Accept only a
  // single committed digit; anything else (e.g. phonetic IMEs) is rolled back.
  handleCompositionStart(e) {
    const input = this.input;
    const k = this.lastKey;
    this.composition = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
      keyOK: !!k && e.timeStamp - k.t < KEY_WINDOW,
      trusted: e.isTrusted
    };
    this.lastKey = null;
  }

  handleCompositionEnd(e) {
    const c = this.composition;
    const data = e.data || '';
    const trusted = e.isTrusted;
    const id = setTimeout(() => {
      this.timers.delete(id);
      this.composition = null;
      if (
        c &&
        trusted &&
        c.trusted &&
        /^[0-9]$/.test(data) &&
        this.typed.length - (c.end - c.start) < this.length
      ) {
        this.typed.splice(c.start, c.end - c.start, {
          ch: data,
          t: performance.now(),
          keyOK: c.keyOK,
          down: null,
          hold: null
        });
      } else if (data) {
        this.say('plainDigits');
      }
      this.sync();
    }, 0);
    this.timers.add(id);
  }
}
