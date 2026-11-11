// Shared helpers for the portal pages.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  dashboard: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 13v-2M11 13V9M15 13v-4"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  upload: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8a4 4 0 0 1 .5 7.97"/><path d="M12 12v8M8.5 15.5L12 12l3.5 3.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h4M14 13h3"/>',
  bank: '<path d="M3 9l9-5 9 5"/><path d="M5 9v8M9.5 9v8M14.5 9v8M19 9v8M3 20h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  minus: '<path d="M6 12h12"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 12h8"/>',
  text: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// `signal` lets a caller cancel a request that a newer one has replaced.
export async function api(method, url, body, { signal } = {}) {
  const options = { method, headers: { 'x-nb-csrf': '1' }, credentials: 'same-origin', signal };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    const error = new Error('Could not reach the server. Check your connection and try again.');
    error.network = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

// The toast stays in the layout (only faded out) so its status role announces each new message.
export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3400);
}

export const fmtDate = ts => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = ts => (ts ? new Date(ts * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtSize = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Check status (Verified / Mismatch / Incomplete / Not applicable) -> tone + icon.
export const CHECK_TONES = { Verified: ['ok', 'check'], Mismatch: ['bad', 'alert'], Incomplete: ['warn', 'alert'], 'Not applicable': ['', 'minus'] };
export const checkPill = status => {
  if (!status) return '<span class="pill">Not checked yet</span>';
  const [tone, glyph] = CHECK_TONES[status] || ['', 'minus'];
  return `<span class="pill ${tone}">${icon(glyph)}${esc(status)}</span>`;
};
export const STATUS_TONES = { draft: '', checking: 'info', action_needed: 'warn', in_review: 'info', approved: 'ok', rejected: 'bad' };

// ---------------------------------------------------------------- rendering
// Repeated renders (polling, refreshes) only touch the DOM where the markup actually changed,
// so focus, hover, running animations and loaded images survive.
const lastMarkup = new WeakMap();
export function patch(el, html) {
  if (lastMarkup.get(el) === html) return false;
  lastMarkup.set(el, html);
  el.innerHTML = html;
  return true;
}
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
function focusKey(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attr = [...el.attributes].find(a => a.name.startsWith('data-'));
  return attr ? `[${attr.name}="${CSS.escape(attr.value)}"]` : null;
}
// Keyed list: `items` is [{ key, html }] where html is one root element. Unchanged rows are left alone.
export function syncKeyed(container, items) {
  const existing = new Map([...container.children].map(child => [child.dataset.key, child]));
  let cursor = container.firstElementChild;
  for (const { key, html } of items) {
    let node = existing.get(String(key));
    if (!node || lastMarkup.get(node) !== html) {
      const template = document.createElement('template');
      template.innerHTML = html.trim();
      const fresh = template.content.firstElementChild;
      fresh.dataset.key = key;
      lastMarkup.set(fresh, html);
      const refocus = node?.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      const selfFocused = node && node === document.activeElement;
      if (node) {
        if (cursor === node) cursor = fresh;
        node.replaceWith(fresh);
      }
      if (selfFocused) fresh.focus();
      else if (refocus) (fresh.matches(refocus) ? fresh : fresh.querySelector(refocus))?.focus();
      node = fresh;
    }
    if (node === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(node, cursor);
    existing.delete(String(key));
  }
  existing.forEach(node => node.remove());
}

// A real pending operation on a button: disabled, with a spinner next to its unchanged label.
export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

// ---------------------------------------------------------------- keyboard
// Arrow / Home / End navigation with a roving tabindex for tab lists and radio groups.
// `activate` selects on arrow (cheap, local switches); leave it off when selecting does a request.
export function rovingTabs(container, { selector = '[role="tab"]', selected = 'aria-selected', activate = false } = {}) {
  const items = () => $$(selector, container).filter(el => !el.hidden && !el.disabled);
  const sync = () => {
    const list = items();
    const current = list.find(el => el.getAttribute(selected) === 'true') || list[0];
    $$(selector, container).forEach(el => { el.tabIndex = el === current ? 0 : -1; });
  };
  container.addEventListener('keydown', e => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const target = e.key === 'Home' ? list[0] : e.key === 'End' ? list[list.length - 1]
      : step ? list[(index + step + list.length) % list.length] : null;
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (activate) target.click();
  });
  new MutationObserver(sync).observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: [selected, 'hidden', 'disabled'] });
  sync();
}

// ---------------------------------------------------------------- confirmation
// Styled replacement for window.confirm(). Resolves true only on the confirm button; Escape, the
// cancel button and a click outside all resolve false. showModal() keeps focus inside the dialog,
// and focus goes back to the control that opened it.
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const trigger = document.activeElement;
    const id = `confirm-${Date.now().toString(36)}`;
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text) node.textContent = text;
      return node;
    };
    const dialog = el('dialog', 'modal modal-confirm');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-text`);
    const head = el('div', 'modal-head');
    const heading = el('h2', '', title);
    heading.id = `${id}-title`;
    head.append(heading);
    const body = el('p', 'modal-body', message);
    body.id = `${id}-text`;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', cancelLabel);
    const confirm = el('button', danger ? 'btn btn-danger' : 'btn btn-primary', confirmLabel);
    cancel.type = confirm.type = 'button';
    actions.append(cancel, confirm);
    dialog.append(head, body, actions);
    cancel.onclick = () => dialog.close('cancel');
    confirm.onclick = () => dialog.close('confirm');
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close('cancel'); });
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
    (danger ? cancel : confirm).focus();  // a destructive action never sits under the default key
  });
}

// ---------------------------------------------------------------- result cues
// Short synthesized sounds for a finished document check (Web Audio; no audio files).
//   Verified   -> bright rising chime, plus a brief on-screen pop
//   Mismatch   -> low falling two-note "no"
//   Incomplete -> soft double tap that stays on one pitch: "something is missing"
// Browsers only allow sound after the user has interacted with the page, so the audio context
// is created on the first click or key press and cues before that are silently skipped.
let audio = null;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, unlockAudio, { capture: true, passive: true }));

function tone(out, { freq, to, at = 0, dur = 0.2, type = 'sine', peak = 1 }) {
  const start = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

const CUE_NOTES = {
  // C major arpeggio up to the octave, with a soft sparkle on top
  verified: [
    { freq: 523.25, at: 0, dur: 0.22, type: 'triangle' }, { freq: 659.25, at: 0.08, dur: 0.22, type: 'triangle' },
    { freq: 783.99, at: 0.16, dur: 0.26, type: 'triangle' }, { freq: 1046.5, at: 0.25, dur: 0.6, type: 'sine' },
    { freq: 2093, at: 0.25, dur: 0.45, type: 'sine', peak: 0.25 }, { freq: 1567.98, at: 0.33, dur: 0.5, type: 'sine', peak: 0.3 },
  ],
  // two low notes stepping down, slightly rough
  reject: [
    { freq: 233.08, to: 220, at: 0, dur: 0.2, type: 'sawtooth', peak: 0.5 }, { freq: 233.08, at: 0, dur: 0.2, type: 'sine' },
    { freq: 164.81, to: 146.83, at: 0.2, dur: 0.38, type: 'sawtooth', peak: 0.5 }, { freq: 164.81, to: 146.83, at: 0.2, dur: 0.38, type: 'sine' },
  ],
  // same pitch twice, light and neutral
  incomplete: [
    { freq: 587.33, at: 0, dur: 0.11, type: 'sine', peak: 0.8 }, { freq: 587.33, at: 0.16, dur: 0.2, type: 'sine', peak: 0.8 },
    { freq: 1174.66, at: 0.16, dur: 0.12, type: 'sine', peak: 0.12 },
  ],
};

export function playCue(kind) {
  const notes = CUE_NOTES[kind];
  if (!notes || !audio || audio.state !== 'running') return;
  const out = audio.createGain();
  const soften = audio.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = kind === 'reject' ? 1400 : 6000;
  out.gain.value = 0.16;
  out.connect(soften).connect(audio.destination);
  notes.forEach(note => tone(out, note));
}

// A brief pop for a verified result: a ring, a tick and a spray of droplets that fade out.
// Decorative only, so it is skipped under reduced motion.
export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $('.celebrate')?.remove();
  const box = document.createElement('div');
  box.className = 'celebrate';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = `<span class="celebrate-ring"></span><span class="celebrate-tick">${icon('check')}</span>`;
  const drops = 14;
  for (let i = 0; i < drops; i++) {
    const drop = document.createElement('i');
    drop.style.setProperty('--a', `${(360 / drops) * i + (i % 2 ? 9 : -6)}deg`);
    drop.style.setProperty('--r', `${i % 3 === 0 ? 150 : i % 3 === 1 ? 112 : 84}px`);
    drop.style.setProperty('--s', `${i % 3 === 0 ? 10 : i % 3 === 1 ? 7 : 5}px`);
    drop.className = ['a', 'b', 'c'][i % 3];
    box.append(drop);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1300);
}

// One entry point: sound (and the pop for Verified) for a check result.
export function resultCue(checkStatus) {
  if (checkStatus === 'Verified') { playCue('verified'); celebrate(); }
  else if (checkStatus === 'Mismatch') playCue('reject');
  else if (checkStatus === 'Incomplete') playCue('incomplete');
}

// Theme: follows the system until the user chooses; the choice is remembered in this browser.
const THEME_KEY = 'nb-theme';
export function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}
export function saveTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* storage unavailable: keep it for this page */ }
}
export function initTheme() {
  const query = matchMedia('(prefers-color-scheme: dark)');
  let choice = savedTheme();
  const button = $('#theme-toggle');
  const apply = () => {
    const dark = choice ? choice === 'dark' : query.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = button.getAttribute('aria-label');
    }
  };
  if (button) button.onclick = () => { choice = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveTheme(choice); apply(); };
  query.addEventListener('change', () => { if (!choice) apply(); });
  apply();
}

export async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* already signed out */ }
  location.reload();
}
