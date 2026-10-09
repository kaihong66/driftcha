/**
 * Document-level bookkeeping of trusted user input, shared by the typing and
 * click guards. All times are event `timeStamp`s (same clock as
 * performance.now()), so a busy main thread cannot inflate them.
 */
export class InputSignals {
  constructor(doc = document) {
    this.doc = doc;
    this.pointerType = 'mouse'; // type of the latest trusted pointerdown
    this.moves = []; // timestamps of recent trusted mouse moves
    this.lastKeyUp = { key: '', t: 0 }; // recorded here so a keyup after a focus change is not lost

    this.onPointerDown = e => {
      if (e.isTrusted) this.pointerType = e.pointerType;
    };
    this.onPointerMove = e => {
      if (!e.isTrusted || e.pointerType !== 'mouse') return;
      this.moves.push(e.timeStamp);
      if (this.moves.length > 256) this.moves.shift();
    };
    this.onKeyUp = e => {
      if (e.isTrusted) this.lastKeyUp = { key: e.key, t: e.timeStamp };
    };

    doc.addEventListener('pointerdown', this.onPointerDown, { capture: true, passive: true });
    doc.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: true });
    doc.addEventListener('keyup', this.onKeyUp, { capture: true });
  }

  /** Number of trusted mouse moves in [t0, t1]. */
  movesBetween(t0, t1) {
    let n = 0;
    for (const t of this.moves) if (t >= t0 && t <= t1) n++;
    return n;
  }

  /** How long `key`, pressed at `down`, was held (up to now if no keyup was seen yet). */
  keyHold(key, down) {
    const { lastKeyUp } = this;
    const up = lastKeyUp.key === key && lastKeyUp.t >= down ? lastKeyUp.t : performance.now();
    return up - down;
  }

  dispose() {
    this.doc.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.doc.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    this.doc.removeEventListener('keyup', this.onKeyUp, { capture: true });
  }
}
