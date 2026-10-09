// Compile-only checks for the public type declarations (`npm run typecheck`).
import http from 'node:http';
import {
  DEFAULT_STAGES,
  checkPow,
  createDriftcha,
  createLocalBackend,
  createServerBackend,
  type Backend,
  type Driftcha,
  type Stage
} from '../src/index.js';
import { createApi } from '../server/api.js';

const stages: Stage[] = DEFAULT_STAGES.map(stage => ({ ...stage, decoys: 1 }));
const local: Backend = createLocalBackend({ stages, length: 5, pow: { bits: 14 } });
const remote: Backend = createServerBackend({ endpoint: '/api' });

const widget: Driftcha = createDriftcha('#captcha', {
  backend: Math.random() > 0.5 ? local : remote,
  theme: 'dark',
  messages: { verify: 'Check' },
  onSuccess: ({ challengeId, token }) => console.log(challengeId, token?.length),
  onFail: ({ stage, reason }) => console.log(stage, reason === 'typing'),
  onStageChange: ({ index, stage }) => console.log(index, stage.color)
});
widget.toggleZoom();
if (widget.solved && widget.token) widget.destroy();

const ok: boolean = checkPow('prefix:', 16, 4, [1, 2, 3, 4]);
console.log(ok);

const api = createApi({ secret: 'dev', fps: 24, onChallenge: ({ code }) => console.log(code.length) });
http.createServer((req, res) => api.middleware(req, res, () => res.end())).listen(8787);

// @ts-expect-error -- theme must be 'light' or 'dark'
createDriftcha('#x', { theme: 'blue' });
