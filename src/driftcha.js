import { DEFAULT_MESSAGES, format } from './messages.js';
import { Renderer } from './core/renderer.js';
import { solvePow, checkPow } from './pow/pow.js';
import { InputSignals } from './guards/signals.js';
import { TypingGuard } from './guards/typing.js';
import { guardClicks } from './guards/click.js';
import { createLocalBackend } from './backends/local.js';

const ROWS = [29.5, 52.5, 75.5, 98.5];

/** The Driftcha mark (same as demo/logo.svg); `id` keeps gradient ids unique per widget. */
const logo = id => `<svg class="dc-logo" viewBox="0 0 128 128" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1c28"/><stop offset="1" stop-color="#121219"/>
    </linearGradient>
    <linearGradient id="${id}-trail" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7d73ff" stop-opacity="0"/><stop offset="1" stop-color="#7d73ff" stop-opacity=".95"/>
    </linearGradient>
    <linearGradient id="${id}-dot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7d73ff"/><stop offset="1" stop-color="#cdc7ff"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="29" fill="url(#${id}-plate)"/>
  <rect x=".5" y=".5" width="127" height="127" rx="28.5" fill="none" stroke="#fff" stroke-opacity=".08"/>
  <g fill="#585770">${ROWS.map(y => [29.5, 52.5, 98.5].map(x => `<circle cx="${x}" cy="${y}" r="6.8"/>`).join('')).join('')}</g>
  <g fill="url(#${id}-trail)">${ROWS.map(y => `<rect x="62" y="${y - 4}" width="18.5" height="8" rx="4"/>`).join('')}</g>
  <g fill="url(#${id}-dot)">${ROWS.map(y => `<circle cx="80.5" cy="${y}" r="6.8"/>`).join('')}</g>
</svg>`;

let instances = 0;

const REFRESH_ICON = `<svg class="dc-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>
</svg>`;

const CHECK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

const ALERT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round"><path d="M12 6.5v7"/><path d="M12 18h.01"/></svg>`;

const EXPAND_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;

const COLLAPSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;

const template = id => `
  <div class="dc-head">
    <div class="dc-brand">
      ${logo(id)}
      <div class="dc-titles">
        <div class="dc-title"></div>
        <div class="dc-subtitle"></div>
      </div>
    </div>
    <ol class="dc-steps"></ol>
  </div>
  <div class="dc-stage">
    <canvas class="dc-canvas" role="img"></canvas>
    <button type="button" class="dc-zoom" aria-pressed="false"></button>
    <div class="dc-loading" hidden><span class="dc-spinner"></span></div>
    <div class="dc-overlay" hidden>
      <div class="dc-overlay-icon"></div>
      <div class="dc-overlay-title"></div>
      <div class="dc-overlay-body"></div>
      <button type="button" class="dc-overlay-button"></button>
    </div>
  </div>
  <div class="dc-controls">
    <div class="dc-code">
      <div class="dc-slots" aria-hidden="true"></div>
      <input class="dc-input" type="text" inputmode="numeric" autocomplete="off" autocorrect="off"
        autocapitalize="off" spellcheck="false" enterkeyhint="next">
    </div>
    <button type="button" class="dc-btn" data-action="reload">
      ${REFRESH_ICON}<span class="dc-label"></span><span class="dc-progress"></span>
    </button>
    <button type="button" class="dc-btn dc-btn-primary" data-action="verify">
      <span class="dc-label"></span><span class="dc-progress"></span>
    </button>
  </div>
  <p class="dc-status" role="status" aria-live="polite"></p>`;

const LOADING_DELAY = 150; // ms before the spinner shows, so quick loads don't flash

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @typedef {object} DriftchaOptions
 * @property {object} [backend] where challenges come from: `createLocalBackend()` (default)
 *   or `createServerBackend({ endpoint })`
 * @property {ReadonlyArray<object>} [stages] stages for the default local backend
 * @property {number} [length=4] digits per code, for the default local backend
 * @property {object} [pow] proof-of-work tuning, for the default local backend
 * @property {Partial<typeof DEFAULT_MESSAGES>} [messages] UI strings
 * @property {'light' | 'dark'} [theme] force a theme (follows the system by default)
 * @property {boolean} [autofocus=false] focus the code field on mount
 * @property {(result: { challengeId: string, token: string | null }) => void} [onSuccess]
 *   `token` is the server's pass token (null with the local backend)
 * @property {(info: { stage: number, reason: 'wrong' | 'typing' }) => void} [onFail]
 * @property {(info: { index: number, stage: object }) => void} [onStageChange]
 */

export class Driftcha {
  /**
   * @param {Element | string} target element or selector to mount into
   * @param {DriftchaOptions} [options]
   */
  constructor(target, options = {}) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('Driftcha: mount target not found');

    this.messages = { ...DEFAULT_MESSAGES, ...options.messages };
    this.backend =
      options.backend ??
      createLocalBackend({ stages: options.stages, length: options.length, pow: options.pow });
    this.callbacks = {
      onSuccess: options.onSuccess,
      onFail: options.onFail,
      onStageChange: options.onStageChange
    };

    this.challenge = null;
    this.stages = [];
    this.stageIndex = -1;
    this.length = 0;
    this.token = null;
    this.busy = false;
    this.solved = false;
    this.destroyed = false;
    this.ticket = 0;
    this.loadingTimer = 0;
    this.cleanups = [];

    this.build(options.theme);
    host.append(this.root);

    this.signals = new InputSignals();
    this.renderer = new Renderer(this.canvas);
    this.typing = new TypingGuard(this.input, {
      length: 4,
      signals: this.signals,
      messages: this.messages,
      onMessage: text => this.say(text, 'error'),
      onChange: () => this.renderSlots(),
      onSubmit: () => {
        this.say(this.messages.pressVerify);
        this.verifyButton.focus();
      }
    });
    this.setLength(options.length ?? 4);

    this.protect(this.verifyButton, 'verify', nonces => this.verify(nonces));
    this.protect(this.reloadButton, 'reload', nonces => this.reload(nonces));
    this.listen(this.overlayButton, 'click', () => this.restart());
    this.listen(this.zoomButton, 'click', () => this.toggleZoom());

    // The slots mirror the transparent input's value, caret and focus.
    const refresh = () => this.renderSlots();
    for (const type of ['focus', 'blur', 'select', 'keyup']) this.listen(this.input, type, refresh);
    this.listen(this.input, 'click', () => {
      const end = this.input.value.length;
      this.input.setSelectionRange(end, end);
      refresh();
    });
    this.listen(document, 'selectionchange', () => {
      if (document.activeElement === this.input) refresh();
    });
    this.listen(this.slotsEl, 'animationend', () => this.slotsEl.classList.remove('is-shake'));

    this.begin({ focus: options.autofocus === true });
  }

  /** Starts over from the first stage with a fresh session. */
  restart() {
    if (!this.destroyed && !this.busy) this.begin();
  }

  /** Stops everything and removes the widget from the page. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.loadingTimer);
    for (const off of this.cleanups.splice(0)) off();
    this.typing.dispose();
    this.signals.dispose();
    this.renderer.destroy();
    this.backend.dispose?.();
    this.placeholder?.remove();
    this.placeholder = null;
    this.dialog?.remove();
    this.root.remove();
  }

  /** Whether the widget is shown enlarged in a modal dialog. */
  get zoomed() {
    return !!this.placeholder;
  }

  toggleZoom() {
    if (this.zoomed) this.unzoom();
    else this.zoom();
  }

  /**
   * Shows the whole widget (noise, code field and buttons) enlarged in a modal
   * dialog. Esc, the shrink button or a click on the backdrop closes it.
   */
  zoom() {
    if (this.destroyed || this.zoomed || typeof HTMLDialogElement === 'undefined') return;
    const focused = this.root.contains(document.activeElement) ? document.activeElement : this.zoomButton;

    if (!this.dialog) {
      this.dialog = document.createElement('dialog');
      this.dialog.className = 'dc-dialog';
      this.dialog.setAttribute('aria-label', this.messages.title);
      // Every way out goes through unzoom() directly rather than relying on the
      // async `close` event, whose timing (and existence) varies between engines.
      const exit = e => {
        e.preventDefault();
        this.unzoom();
      };
      this.dialog.addEventListener('cancel', exit);
      this.dialog.addEventListener('keydown', e => {
        if (e.key === 'Escape') exit(e);
      });
      // A click on the backdrop targets the dialog itself.
      this.dialog.addEventListener('click', e => {
        if (e.target === this.dialog) exit(e);
      });
      this.dialog.addEventListener('close', () => this.unzoom());
    }

    // Keep the page layout stable while the widget is away.
    this.placeholder = document.createElement('div');
    this.placeholder.style.height = `${this.root.offsetHeight}px`;
    this.root.before(this.placeholder);

    document.body.append(this.dialog);
    this.dialog.append(this.root);
    this.root.classList.add('is-zoomed');
    this.dialog.showModal();
    this.renderZoomButton();
    focused.focus({ preventScroll: true });
  }

  unzoom() {
    if (!this.zoomed) return;
    const focused = this.root.contains(document.activeElement) ? document.activeElement : this.zoomButton;
    this.placeholder.replaceWith(this.root);
    this.placeholder = null;
    this.root.classList.remove('is-zoomed');
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    this.renderZoomButton();
    focused.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- flow

  async begin({ focus = true } = {}) {
    const ticket = ++this.ticket;
    this.solved = false;
    this.token = null;
    this.overlay.hidden = true;
    delete this.root.dataset.state;
    this.setDisabled(true);
    this.setLoading(true);
    this.say(this.messages.loading);

    let challenge;
    try {
      challenge = await this.backend.start();
    } catch (err) {
      if (!this.destroyed && ticket === this.ticket) this.showError(err);
      return;
    }
    if (this.destroyed || ticket !== this.ticket) {
      challenge.source.dispose();
      return;
    }
    this.setDisabled(false);
    this.stageIndex = -1;
    this.apply(challenge, { focus });
    this.renderer.start();
  }

  apply(challenge, { focus = true } = {}) {
    const changed = challenge.stageIndex !== this.stageIndex;
    this.challenge = challenge;
    this.stageIndex = challenge.stageIndex;
    this.setStages(challenge.stages);
    this.setLength(challenge.length);

    const stage = this.stages[this.stageIndex];
    const { source } = challenge;
    this.stageEl.style.aspectRatio = `${source.width} / ${source.height}`;
    this.renderer.setSource(source, !!stage.color);
    this.watch(source);

    this.typing.clear();
    this.renderSteps();
    this.say(format(this.messages.prompt, { length: this.length, description: stage.description }));
    if (focus) this.input.focus({ preventScroll: true });
    if (changed) this.callbacks.onStageChange?.({ index: this.stageIndex, stage });
  }

  watch(source) {
    const current = () => this.challenge?.source === source && !this.solved && !this.destroyed;
    if (source.ready) this.setLoading(false);
    else this.setLoading(true);
    source.onReady = () => {
      if (current()) this.setLoading(false);
    };
    source.onError = err => {
      if (current()) this.showError(err);
    };
    source.onEnd = () => {
      if (current() && !this.busy) this.say(this.messages.timedOut, 'error');
    };
  }

  async verify(nonces) {
    const m = this.messages;
    const value = this.typing.value;

    if (!this.typing.synced || value.length !== this.length) {
      if (!this.typing.synced) this.typing.clear();
      this.say(format(m.needDigits, { length: this.length }), 'error');
      this.shake();
      return;
    }

    if (!this.typing.looksHuman()) {
      this.typing.clear();
      this.say(m.typingRejected, 'error');
      this.shake();
      this.callbacks.onFail?.({ stage: this.stageIndex, reason: 'typing' });
      return;
    }

    const stage = this.stageIndex;
    const outcome = await this.backend.act('verify', { answer: value, nonces });
    if (!this.destroyed) this.handle(outcome, stage);
  }

  async reload(nonces) {
    const stage = this.stageIndex;
    const outcome = await this.backend.act('reload', { nonces });
    if (!this.destroyed) this.handle(outcome, stage);
  }

  handle(outcome, stage) {
    const m = this.messages;
    switch (outcome.result) {
      case 'wrong':
        this.apply(outcome.challenge);
        this.say(m.wrong, 'error');
        this.shake();
        this.callbacks.onFail?.({ stage, reason: 'wrong' });
        break;
      case 'next':
        this.apply(outcome.challenge);
        this.say(
          format(m.stagePassed, { done: stage + 1, description: this.stages[this.stageIndex].description }),
          'ok'
        );
        break;
      case 'solved':
        this.complete(outcome.token);
        break;
      case 'reloaded':
        this.apply(outcome.challenge);
        break;
      case 'expired':
        this.apply(outcome.challenge);
        this.say(m.expired, 'error');
        break;
      case 'early': // sent before the server's minimum solve time; the code is still live
        this.say(m.tooFast, 'error');
        break;
      default: // 'rejected': the proof of work did not check out
        this.say(m.clickRejected, 'error');
    }
  }

  complete(token) {
    const m = this.messages;
    this.solved = true;
    this.token = token;
    this.input.blur();
    this.setDisabled(true);
    this.setLoading(false);
    this.renderer.stop();
    this.renderer.detach();
    this.showOverlay('done', m.doneTitle, format(m.doneBody, { count: this.stages.length }), m.restart);
    this.root.dataset.state = 'solved';
    this.renderSteps();
    this.renderSlots();
    this.say(m.success, 'ok');
    this.overlayButton.focus({ preventScroll: true });
    this.callbacks.onSuccess?.({ challengeId: this.challenge.id, token });
  }

  showError(err) {
    const m = this.messages;
    console.warn('Driftcha:', err);
    this.setLoading(false);
    this.setDisabled(true);
    this.renderer.stop();
    this.showOverlay('error', m.errorTitle, err?.status === 429 ? err.message : m.errorBody, m.retry);
    this.say(m.networkError, 'error');
  }

  /**
   * Wires a button so that a click runs `action(nonces)` only after it passes
   * the click guard and a proof of work. Both buttons share one lock, so only
   * one action is processed at a time.
   */
  protect(button, name, action) {
    const m = this.messages;
    const label = button.querySelector('.dc-label');
    const bar = button.querySelector('.dc-progress');
    let failTimer = 0;

    const idleText = () => (name === 'verify' ? m.verify : m.reload);

    const reset = () => {
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-busy', 'is-ok');
      label.textContent = idleText();
      bar.style.transform = 'scaleX(0)';
      this.input.readOnly = false;
      this.busy = false;
    };

    const fail = () => {
      clearTimeout(failTimer);
      label.textContent = m.failed;
      button.classList.add('is-fail');
      this.say(m.clickRejected, 'error');
      failTimer = setTimeout(() => {
        button.classList.remove('is-fail');
        if (!this.busy) label.textContent = idleText();
      }, 650);
    };

    const run = async (path, key) => {
      const challenge = this.challenge;
      const params = challenge && this.backend.powParams(name);
      if (!params) return;

      this.busy = true;
      clearTimeout(failTimer);
      button.classList.remove('is-fail');
      this.input.readOnly = true; // check exactly what was in the field at click time
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('is-busy');
      label.textContent = m.busy;
      bar.style.transform = 'scaleX(0)';

      try {
        const nonces = await solvePow(params.prefix, params.bits, params.count, progress => {
          bar.style.transform = `scaleX(${progress})`;
        });
        if (this.destroyed) return;

        let pass = challenge === this.challenge && checkPow(params.prefix, params.bits, params.count, nonces);
        // Keyboard path: a key pressed and released at the same instant is not a person.
        if (pass && path === 'key' && this.signals.keyHold(key.key, key.down) < 15) pass = false;
        if (!pass) {
          reset();
          fail();
          return;
        }

        bar.style.transform = 'scaleX(1)';
        button.classList.remove('is-busy');
        button.classList.add('is-ok');
        label.textContent = m.passed;
        await sleep(110);
        if (this.destroyed) return;
        this.input.readOnly = false;
        await action(nonces);
      } catch (err) {
        if (!this.destroyed) this.showError(err);
      } finally {
        if (this.busy) reset();
      }
    };

    this.cleanups.push(
      guardClicks(button, {
        signals: this.signals,
        isBusy: () => this.busy || this.solved || button.disabled,
        onAttempt: ({ ok, path, key }) => (ok ? run(path, key) : fail())
      })
    );
    this.cleanups.push(() => clearTimeout(failTimer));
  }

  // ---------------------------------------------------------------- view

  build(theme) {
    const m = this.messages;
    const root = document.createElement('div');
    root.className = 'driftcha';
    if (theme) root.dataset.theme = theme;
    root.innerHTML = template(`dc${++instances}`);
    const $ = selector => root.querySelector(selector);

    this.root = root;
    this.stageEl = $('.dc-stage');
    this.canvas = $('.dc-canvas');
    this.input = $('.dc-input');
    this.slotsEl = $('.dc-slots');
    this.stepsEl = $('.dc-steps');
    this.statusEl = $('.dc-status');
    this.loadingEl = $('.dc-loading');
    this.overlay = $('.dc-overlay');
    this.overlayButton = $('.dc-overlay-button');
    this.zoomButton = $('.dc-zoom');
    this.verifyButton = $('[data-action="verify"]');
    this.reloadButton = $('[data-action="reload"]');
    this.stepEls = [];
    this.slotEls = [];

    $('.dc-title').textContent = m.title;
    $('.dc-subtitle').textContent = m.subtitle;
    this.stageEl.style.aspectRatio = '13 / 6';
    this.canvas.setAttribute('aria-label', m.canvasLabel);
    this.input.setAttribute('aria-label', m.inputLabel);
    this.verifyButton.querySelector('.dc-label').textContent = m.verify;
    this.reloadButton.querySelector('.dc-label').textContent = m.reload;
    this.stepsEl.setAttribute('aria-label', m.progressLabel);
    this.stepsEl.hidden = true;
    this.placeholder = null;
    this.dialog = null;
    this.zoomButton.hidden = typeof HTMLDialogElement === 'undefined';
    this.renderZoomButton();
  }

  renderZoomButton() {
    const zoomed = this.zoomed;
    const label = zoomed ? this.messages.zoomOut : this.messages.zoomIn;
    this.zoomButton.innerHTML = zoomed ? COLLAPSE_ICON : EXPAND_ICON;
    this.zoomButton.setAttribute('aria-label', label);
    this.zoomButton.setAttribute('aria-pressed', String(zoomed));
    this.zoomButton.title = label;
  }

  setStages(stages) {
    const same = stages.length === this.stages.length && stages.every((s, i) => s.id === this.stages[i].id);
    this.stages = stages;
    if (same && this.stepEls.length) return;
    this.stepsEl.replaceChildren();
    this.stepEls = stages.map((stage, i) => {
      const item = document.createElement('li');
      item.className = 'dc-step';
      const num = document.createElement('span');
      num.className = 'dc-step-num';
      num.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'dc-step-name';
      name.textContent = stage.label;
      item.append(num, name);
      this.stepsEl.append(item);
      return item;
    });
    this.stepsEl.hidden = stages.length < 2;
  }

  setLength(length) {
    if (length === this.length) return;
    this.length = length;
    this.typing.length = length;
    this.input.maxLength = length;
    this.slotsEl.replaceChildren();
    this.slotEls = Array.from({ length }, () => {
      const slot = document.createElement('span');
      slot.className = 'dc-slot';
      this.slotsEl.append(slot);
      return slot;
    });
    this.renderSlots();
  }

  renderSteps() {
    this.stepEls.forEach((item, i) => {
      const done = this.solved || i < this.stageIndex;
      const current = !this.solved && i === this.stageIndex;
      item.classList.toggle('is-done', done);
      item.classList.toggle('is-current', current);
      if (current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.firstChild.textContent = done ? '✓' : String(i + 1);
    });
  }

  renderSlots() {
    const { input, length } = this;
    const value = input.value.slice(0, length);
    const focused = document.activeElement === input && !input.disabled;
    const start = Math.min(input.selectionStart ?? value.length, length);
    const end = Math.min(input.selectionEnd ?? start, length);
    const collapsed = start === end;

    this.slotEls.forEach((slot, i) => {
      const ch = value[i] ?? '';
      if (slot.textContent !== ch) slot.textContent = ch;
      const active = focused && (collapsed ? i === Math.min(start, length - 1) : i >= start && i < end);
      slot.classList.toggle('is-filled', ch !== '');
      slot.classList.toggle('is-active', active);
      slot.classList.toggle('is-caret', focused && collapsed && i === start && ch === '');
    });
  }

  showOverlay(kind, title, body, button) {
    this.overlay.dataset.kind = kind;
    this.overlay.querySelector('.dc-overlay-icon').innerHTML = kind === 'done' ? CHECK_ICON : ALERT_ICON;
    this.overlay.querySelector('.dc-overlay-title').textContent = title;
    this.overlay.querySelector('.dc-overlay-body').textContent = body;
    this.overlayButton.textContent = button;
    this.overlay.hidden = false;
  }

  setLoading(on) {
    clearTimeout(this.loadingTimer);
    if (!on) {
      this.loadingEl.hidden = true;
      return;
    }
    this.loadingTimer = setTimeout(() => {
      this.loadingEl.hidden = false;
    }, LOADING_DELAY);
  }

  setDisabled(disabled) {
    this.input.disabled = disabled;
    this.verifyButton.disabled = disabled;
    this.reloadButton.disabled = disabled;
  }

  shake() {
    const el = this.slotsEl;
    el.classList.remove('is-shake');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-shake');
  }

  say(text, tone = '') {
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}

/** Mounts a Driftcha widget. Same as `new Driftcha(target, options)`. */
export function createDriftcha(target, options) {
  return new Driftcha(target, options);
}
