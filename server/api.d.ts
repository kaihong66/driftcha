// Type declarations for the Driftcha mock server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PowConfig, Stage } from '../src/index.js';

export interface RateLimit {
  /** Window length in ms. Default 60000. */
  window: number;
  /** Verify + reload requests per window. Default 20; `Infinity` disables. */
  attempts: number;
  /** New sessions per window. Default 10; `Infinity` disables. */
  sessions: number;
}

export interface ApiOptions {
  stages?: readonly Stage[];
  /** Digits per code. Default 4. */
  length?: number;
  pow?: Partial<PowConfig>;
  /** Stream frame rate. Default 30. */
  fps?: number;
  /** HMAC key for pass tokens. Random per process when unset. */
  secret?: string;
  /** Challenge lifetime in ms. Default 5 minutes. */
  challengeTtl?: number;
  /** Idle session lifetime in ms. Default 15 minutes. */
  sessionTtl?: number;
  /** Pass token lifetime in ms. Default 2 minutes. */
  tokenTtl?: number;
  maxSessions?: number;
  maxSessionsPerIp?: number;
  maxStreams?: number;
  /**
   * Minimum ms between a challenge's first streamed frame and an accepted answer.
   * Earlier answers get `result: 'early'` without being checked. Default 4000; 0 disables.
   */
  minSolveTime?: number;
  /** Sliding-window limits per client IP; over the limit answers HTTP 429 with Retry-After. */
  rateLimit?: Partial<RateLimit>;
  /**
   * Client address used for the per-IP limits and proof-of-work penalties.
   * Default: the socket's remote address. Behind a reverse proxy, read the proxy's
   * client-address header here, or every visitor shares one IP.
   */
  clientIp?: (req: IncomingMessage) => string;
  /** Called with every new challenge, answer included. For tests and inspection only. */
  onChallenge?: (info: { session: string; id: string; stage: number; code: string }) => void;
  /**
   * Called after each streamed frame with the pixel → shape-layer map (0 =
   * background). The array is reused; copy it to keep it. Reveals where the
   * digits are: for tests and inspection only.
   */
  onFrame?: (info: { challenge: string; index: number; owner: Uint8Array }) => void;
}

export interface Api {
  /** Handles `/api/*` routes and calls `next()` for anything else. */
  middleware(req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<void>;
  /** Stops timers and open streams. */
  close(): void;
}

export function createApi(options?: ApiOptions): Api;
