// Type declarations for the Driftcha widget and backends.

/** Parameters of one challenge round. */
export interface Stage {
  id: string;
  /** Short label for the round indicator. */
  label: string;
  /** Used in prompts, e.g. "black-and-white". */
  description: string;
  /** `false` for black-and-white dots, `true` for random RGB. */
  color: boolean;
  /** Dot lifetime range in seconds. */
  life: readonly [number, number];
  /** Dot texture flow speed range in raw px/s, shared by digits and background. */
  speed: readonly [number, number];
  /** Maximum digit rotation in degrees, at full distortion. */
  tilt: number;
  /**
   * Geometric distortion strength, 0 (upright, unwarped; the default) to 1 (full).
   * Even full strength only trips weak OCR engines; strong OCR and vision-language
   * models read it fine, so it mostly makes the digits harder for people.
   */
  distortion?: number;
  /**
   * Share of pixels (0–1) replaced each frame by a fresh random dot that lives
   * for one frame and carries no motion. Weakens frame-to-frame matching for
   * machines and people alike. Default 0.
   */
  noise?: number;
  /**
   * Share of pixels (0–1) that show a random neighbour's dot each frame, so dots
   * wobble by a pixel instead of sliding rigidly. Default 0.
   */
  jitter?: number;
  /** Number of background plates (1–256). */
  plates: number;
  /** Number of non-digit distractor shapes. */
  decoys: number;
}

/** The part of a stage the browser sees in server mode. */
export interface StageInfo {
  id: string;
  label: string;
  description: string;
  color: boolean;
}

export interface PowConfig {
  /** Leading zero bits required per nonce. */
  bits: number;
  /** Nonces required per proof. */
  count: number;
  /** Extra bits per recent wrong answer (each bit doubles the work). Default 2. */
  bitsPerWrong: number;
  /** Extra bits per recent reload. Default 1. */
  bitsPerReload: number;
  /** Extra bits added for recent wrong answers / reloads, at most. Default 8. */
  maxPenaltyBits: number;
  /** How long (ms) a wrong answer or reload counts as a penalty. */
  penaltyWindow: number;
}

export interface FieldSize {
  width: number;
  height: number;
  scale: number;
}

export interface DriftchaMessages {
  title: string;
  subtitle: string;
  progressLabel: string;
  canvasLabel: string;
  inputLabel: string;
  zoomIn: string;
  zoomOut: string;
  verify: string;
  reload: string;
  busy: string;
  passed: string;
  failed: string;
  loading: string;
  /** Placeholders: `{length}`, `{description}`. */
  prompt: string;
  pressVerify: string;
  /** Placeholder: `{length}`. */
  needDigits: string;
  typingRejected: string;
  wrong: string;
  /** Placeholders: `{done}`, `{description}`. */
  stagePassed: string;
  clickRejected: string;
  /** Shown when the server refuses an answer as too quick (`result: 'early'`). */
  tooFast: string;
  success: string;
  expired: string;
  timedOut: string;
  networkError: string;
  oneAtATime: string;
  noPaste: string;
  noAutocorrect: string;
  plainDigits: string;
  doneTitle: string;
  /** Placeholder: `{count}`. */
  doneBody: string;
  restart: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
}

/** Supplies raw noise frames (0xAABBGGRR pixels) to the renderer. */
export interface FrameSource {
  readonly width: number;
  readonly height: number;
  readonly ready: boolean;
  frame(t: number, dt: number): Uint32Array | null;
  dispose(): void;
  onReady?: (() => void) | null;
  onEnd?: (() => void) | null;
  onError?: ((error: unknown) => void) | null;
}

export interface Challenge {
  id: string;
  stageIndex: number;
  stages: StageInfo[];
  length: number;
  source: FrameSource;
}

export type BackendAction = 'verify' | 'reload';

/**
 * `rejected`: bad proof of work. `early` (server only): the answer came in before the
 * minimum solve time and was not checked; the challenge stays live.
 */
export type OutcomeResult = 'wrong' | 'next' | 'solved' | 'reloaded' | 'expired' | 'rejected' | 'early';

export interface Outcome {
  result: OutcomeResult;
  challenge?: Challenge | null;
  /** Pass token, only with `result: 'solved'` in server mode. */
  token?: string | null;
}

export interface PowParams {
  prefix: string;
  bits: number;
  count: number;
}

/** Where challenges come from. See `createLocalBackend` and `createServerBackend`. */
export interface Backend {
  readonly kind?: string;
  start(): Promise<Challenge>;
  powParams(action: BackendAction): PowParams | null;
  act(action: 'verify', payload: { answer: string; nonces: number[] }): Promise<Outcome>;
  act(action: 'reload', payload: { nonces: number[] }): Promise<Outcome>;
  dispose?(): void;
}

export interface LocalBackendOptions {
  stages?: readonly Stage[];
  /** Digits per code. Default 4. */
  length?: number;
  pow?: Partial<PowConfig>;
}

/** Everything runs in the page. The answer lives in page memory. */
export function createLocalBackend(options?: LocalBackendOptions): Backend;

export interface ServerBackendOptions {
  /** API base URL. Default `'/api'`. */
  endpoint?: string;
}

/** Talks to a Driftcha server; the answer never reaches the page. */
export function createServerBackend(options?: ServerBackendOptions): Backend;

export interface SuccessResult {
  challengeId: string;
  /** Server pass token to send to your backend; `null` with the local backend. */
  token: string | null;
}

export interface FailInfo {
  /** Zero-based round index. */
  stage: number;
  reason: 'wrong' | 'typing';
}

export interface StageChangeInfo {
  index: number;
  stage: StageInfo;
}

export interface DriftchaOptions {
  /** Default: `createLocalBackend({ stages, length, pow })`. */
  backend?: Backend;
  /** Shorthand for the default local backend. */
  stages?: readonly Stage[];
  /** Shorthand for the default local backend. */
  length?: number;
  /** Shorthand for the default local backend. */
  pow?: Partial<PowConfig>;
  messages?: Partial<DriftchaMessages>;
  /** Force a color scheme; follows the system by default. */
  theme?: 'light' | 'dark';
  /** Focus the code field on mount. Default `false`. */
  autofocus?: boolean;
  onSuccess?: (result: SuccessResult) => void;
  onFail?: (info: FailInfo) => void;
  onStageChange?: (info: StageChangeInfo) => void;
}

export class Driftcha {
  /** @param target element or CSS selector to mount into */
  constructor(target: Element | string, options?: DriftchaOptions);
  /** The widget's root element (`.driftcha`). */
  readonly root: HTMLDivElement;
  readonly backend: Backend;
  /** Zero-based index of the current round. */
  readonly stageIndex: number;
  readonly solved: boolean;
  /** Pass token after success in server mode. */
  readonly token: string | null;
  /** Whether the enlarged view is open. */
  readonly zoomed: boolean;
  /** Starts over from the first round with a fresh session. */
  restart(): void;
  /** Opens the enlarged view. */
  zoom(): void;
  /** Closes the enlarged view. */
  unzoom(): void;
  toggleZoom(): void;
  /** Stops everything and removes the widget from the page. */
  destroy(): void;
}

/** Mounts a widget. Same as `new Driftcha(target, options)`. */
export function createDriftcha(target: Element | string, options?: DriftchaOptions): Driftcha;

export const DEFAULT_STAGES: readonly Stage[];
export const FIELD: Readonly<FieldSize>;
export const POW: Readonly<PowConfig>;
export const DEFAULT_MESSAGES: Readonly<DriftchaMessages>;

/** Finds `count` nonces for `prefix` (in a Web Worker when available). */
export function solvePow(
  prefix: string,
  bits: number,
  count: number,
  onProgress?: (progress: number) => void
): Promise<number[]>;

/** Checks a proof of work. Has no DOM dependencies; works on Node.js. */
export function checkPow(prefix: string, bits: number, count: number, nonces: unknown): boolean;
