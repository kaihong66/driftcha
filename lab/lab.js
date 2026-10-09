// Driftcha lab: tune the motion model and measure how readable it is for people.
// Uses the server's vector digits and the widget's renderer, so what you see
// matches mock-server mode.
import { DEFAULT_STAGES, FIELD } from '../src/config.js';
import { Scene } from '../src/core/scene.js';
import { vectorGlyphs } from '../src/core/vector-glyphs.js';
import { secureCode } from '../src/core/random.js';
import { Renderer } from '../src/core/renderer.js';

// Machine scores from the red-team motion probe: how accurately digit pixels can
// be told from background by their estimated motion (50% = chance), best of three
// block-matching setups (7×7 / 8 frame pairs, 13×13 / 16, 17×17 / 24).
const PRESETS = [
  { name: 'Current default', probe: '~93%', life: [0.22, 0.55], noise: 0, jitter: 0 },
  { name: 'Short life', probe: '~85%', life: [0.03, 0.07], noise: 0, jitter: 0 },
  { name: 'Noise 0.5', probe: '~78%', life: [0.22, 0.55], noise: 0.5, jitter: 0 },
  { name: 'Combo A', probe: '~72%', life: [0.06, 0.12], noise: 0.3, jitter: 0.3 },
  { name: 'Combo B', probe: '~59%', life: [0.05, 0.1], noise: 0.5, jitter: 0.5 }
];

const $ = id => document.getElementById(id);
const controls = {
  color: $('color'),
  lifeMin: $('lifeMin'),
  lifeMax: $('lifeMax'),
  noise: $('noise'),
  jitter: $('jitter'),
  distortion: $('distortion')
};

const scene = new Scene(FIELD.width, FIELD.height, vectorGlyphs);
const renderer = new Renderer($('view'));
const tally = new Map(); // settings signature -> { right, tries, ms }
let stage = null;
let code = '';
let shownAt = 0;

function readStage() {
  const base = DEFAULT_STAGES.find(s => s.id === controls.color.value);
  let min = Number(controls.lifeMin.value) / 1000;
  let max = Number(controls.lifeMax.value) / 1000;
  if (max < min) [min, max] = [max, min];
  return {
    ...base,
    life: [min, max],
    noise: Number(controls.noise.value),
    jitter: Number(controls.jitter.value),
    distortion: Number(controls.distortion.value)
  };
}

function signature(s) {
  return `${s.id} life ${s.life.map(v => Math.round(v * 1000)).join('–')}ms noise ${s.noise} jitter ${s.jitter} dist ${s.distortion}`;
}

function showValues() {
  for (const [id, input] of Object.entries(controls)) {
    const out = document.querySelector(`output[for="${id}"]`);
    if (!out) continue;
    out.textContent = id.startsWith('life') ? `${input.value} ms` : Number(input.value).toFixed(2);
  }
  const { id, life, noise, jitter, distortion } = readStage();
  $('config').textContent = JSON.stringify({ id, life, noise, jitter, distortion }, null, 2);
}

/** A fresh code with the current settings. */
function next() {
  stage = readStage();
  code = secureCode(4);
  scene.reset(stage, code, performance.now() / 1000);
  renderer.setSource(
    {
      width: scene.width,
      height: scene.height,
      ready: true,
      frame: (t, dt) => {
        scene.step(dt, t);
        scene.render(t);
        return scene.pixels;
      },
      dispose() {}
    },
    stage.color
  );
  $('answer').value = '';
  $('answer').focus();
  shownAt = performance.now();
}

function renderTally() {
  const body = $('tally');
  body.replaceChildren();
  for (const [key, { right, tries, ms }] of tally) {
    const row = document.createElement('tr');
    const cells = [
      key,
      `${right} (${Math.round((100 * right) / tries)}%)`,
      String(tries),
      `${(ms / tries / 1000).toFixed(1)} s`
    ];
    for (const text of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
  }
}

function applyPreset(preset) {
  controls.lifeMin.value = String(Math.round(preset.life[0] * 1000));
  controls.lifeMax.value = String(Math.round(preset.life[1] * 1000));
  controls.noise.value = String(preset.noise);
  controls.jitter.value = String(preset.jitter);
  showValues();
  next();
}

for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = `<span></span><small></small>`;
  button.firstChild.textContent = preset.name;
  button.lastChild.textContent = `probe ${preset.probe}`;
  button.addEventListener('click', () => applyPreset(preset));
  $('presets').append(button);
}

for (const input of Object.values(controls)) {
  input.addEventListener('input', showValues);
  input.addEventListener('change', next);
}

$('guess').addEventListener('submit', event => {
  event.preventDefault();
  const guess = $('answer').value.trim();
  const key = signature(stage);
  const entry = tally.get(key) ?? { right: 0, tries: 0, ms: 0 };
  entry.tries++;
  entry.ms += performance.now() - shownAt; // from the code appearing to pressing Check, typing included
  const ok = guess === code;
  if (ok) entry.right++;
  tally.set(key, entry);
  const result = $('result');
  result.textContent = ok ? `✓ ${code}` : `✗ it was ${code}`;
  result.className = ok ? 'ok' : 'bad';
  renderTally();
  next();
});

$('skip').addEventListener('click', () => {
  $('result').textContent = `skipped: it was ${code}`;
  $('result').className = '';
  next();
});

controls.distortion.value = '0';
applyPreset(PRESETS[0]);
renderer.start();
