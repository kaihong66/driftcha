import { createDriftcha, createLocalBackend, createServerBackend } from '../src/index.js';
import { mountExplainer } from './explainer.js';

const API = './api';
const MAX_EVENTS = 7;

const eventsList = document.getElementById('events');
const note = document.getElementById('mode-note');
const options = [...document.querySelectorAll('.mode-option')];

const NOTES = {
  server:
    'The mock server picks the code, renders the noise and streams frames. The answer never reaches this page.',
  local: 'Everything runs in this page. Fine for static hosting, but the answer lives in page memory.',
  offline:
    'No server here (static hosting), so the widget runs in the browser. Run the project locally (npm run dev) to try the mock server.'
};

function logEvent(name, detail) {
  eventsList.querySelector('.events-empty')?.remove();

  const item = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], { hour12: false });
  const label = document.createElement('code');
  label.textContent = name;
  label.dataset.kind = name;
  const text = document.createElement('span');
  text.textContent = detail;
  item.append(time, label, text);

  eventsList.prepend(item);
  while (eventsList.children.length > MAX_EVENTS) eventsList.lastElementChild.remove();
}

/** Plays the part of your site's backend: checks the pass token with the server. */
async function verifyToken(token) {
  try {
    const res = await fetch(`${API}/siteverify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const result = await res.json();
    logEvent(
      'siteverify',
      result.success ? `success, challenge ${result.challengeId}` : `failed: ${result.error}`
    );
  } catch {
    logEvent('siteverify', 'request failed');
  }
}

async function hasServer() {
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

let widget = null;

function mount(mode, serverAvailable) {
  widget?.destroy();
  for (const option of options) {
    const selected = option.dataset.mode === mode;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
  note.textContent = serverAvailable ? NOTES[mode] : NOTES.offline;
  document.getElementById('modes-table').dataset.active = mode;

  widget = createDriftcha('#captcha', {
    backend: mode === 'server' ? createServerBackend({ endpoint: API }) : createLocalBackend(),
    onStageChange: ({ index, stage }) => logEvent('onStageChange', `round ${index + 1}: ${stage.id}`),
    onFail: ({ stage, reason }) => logEvent('onFail', `round ${stage + 1}: ${reason}`),
    onSuccess: ({ challengeId, token }) => {
      logEvent('onSuccess', token ? `token ${token.slice(0, 16)}…` : `challenge ${challengeId}`);
      if (token) verifyToken(token);
    }
  });
}

mountExplainer(document.getElementById('explainer'), document.getElementById('explainer-shuffle'));

const serverAvailable = await hasServer();
const serverOption = options.find(o => o.dataset.mode === 'server');
serverOption.disabled = !serverAvailable;
for (const option of options) {
  option.addEventListener('click', () => {
    if (option.getAttribute('aria-checked') !== 'true') mount(option.dataset.mode, serverAvailable);
  });
}
mount(serverAvailable ? 'server' : 'local', serverAvailable);

// On GitHub Pages (<user>.github.io/<repo>/), link back to the repository.
const source = document.getElementById('source-link');
const owner = location.hostname.match(/^([\w-]+)\.github\.io$/i)?.[1];
const repo = location.pathname.split('/').filter(Boolean)[0];
if (owner && repo) {
  source.href = `https://github.com/${owner}/${repo}`;
  source.hidden = false;
}
