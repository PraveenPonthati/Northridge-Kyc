import { $, $$, esc, icon, api, fmtDate, fmtDateTime, checkPill, STATUS_TONES, initTheme, logout, setText, syncKeyed, setBusy, rovingTabs } from '/common.js';

initTheme();

const FILTERS = [
  ['in_review', 'Under review'], ['action_needed', 'Action needed'], ['checking', 'Checking'],
  ['draft', 'Documents needed'], ['approved', 'Approved'], ['rejected', 'Not approved'], ['', 'All'],
];
const TILES = [['in_review', 'Needs review', 'shield'], ['action_needed', 'Waiting on borrower', 'alert'], ['approved', 'Approved', 'check'], ['rejected', 'Not approved', 'x']];
let filter = 'in_review';
let search = '';
let searchTimer = null;
// Only the newest request may update the queue: older ones are cancelled and, if they still
// resolve, ignored by sequence number.
let loadSeq = 0;
let loadAbort = null;
let loaded = false;

// Tiles and filters are built once; later loads only change their numbers and selected state,
// so the control that was clicked keeps focus.
function buildControls() {
  $('#tiles').innerHTML = TILES.map(([key, label, glyph]) => `<button class="card stat-tile ${STATUS_TONES[key]}" type="button" data-tile="${key}" aria-pressed="false"><span><b data-count>—</b><small>${label}</small></span><span class="stat-icon">${icon(glyph)}</span></button>`).join('');
  $('#filters').innerHTML = FILTERS.map(([key, label]) => `<button role="tab" type="button" aria-controls="queue-panel" data-filter="${key}" aria-selected="false">${label}<span class="count" data-count>—</span></button>`).join('');
  $$('[data-tile]').forEach(b => { b.onclick = () => setFilter(b.dataset.tile); });
  $$('[data-filter]').forEach(b => { b.onclick = () => setFilter(b.dataset.filter); });
  rovingTabs($('#filters'));
  markFilter();
}

function markFilter() {
  $$('[data-filter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.filter === filter)));
  $$('[data-tile]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tile === filter)));
}

function setFilter(next) {
  filter = next;
  markFilter();   // the selection responds at once; rows follow when the request returns
  load();
}

function renderCounts(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $$('[data-tile]').forEach(b => setText($('[data-count]', b), String(counts[b.dataset.tile] || 0)));
  $$('[data-filter]').forEach(b => setText($('[data-count]', b), String(b.dataset.filter ? (counts[b.dataset.filter] || 0) : total)));
}

const rowHtml = (r, first) => `
    <tr class="tone-${STATUS_TONES[r.status] || 'none'}" data-open="${r.id}" tabindex="0" role="link" aria-label="Open application ${esc(r.ref)}">
      <td data-label="Borrower">${first}</td>
      <td data-label="Application ID" class="num">${esc(r.ref)}</td>
      <td data-label="Status"><span class="status-badge ${STATUS_TONES[r.status] || ''}">${esc(r.status_label)}</span></td>
      <td data-label="Document check">${checkPill(r.check_status)}${r.review_required ? `<small class="cell-flag">${icon('alert')}Needs human review</small>` : ''}</td>
      <td data-label="Documents">${r.documents}${r.reuploads ? ` <small class="cell-flag">${r.reuploads} re-upload</small>` : ''}</td>
      <td data-label="Submitted">${fmtDate(r.submitted)}</td>
      <td data-label="Updated">${fmtDateTime(r.updated)}</td>
    </tr>`;

// Runs from the administrator test account: listed apart, below the queue, in a collapsible section.
function renderAdminTests(rows = []) {
  const box = $('#admin-tests');
  box.hidden = rows.length === 0;
  setText($('#admin-tests-count'), String(rows.length));
  syncKeyed($('#admin-tests-body'), rows.map((r, i) => ({ key: r.id, html: rowHtml(r, `<b>Test run ${rows.length - i}</b><small class="cell-sub">Administrator test</small>`) })));
}

function renderRows(rows, refQuery) {
  const empty = $('#queue-empty');
  empty.hidden = rows.length > 0;
  // A complete application number is verified by its check digits before it is looked up.
  empty.textContent = refQuery && !refQuery.valid ? `${refQuery.ref} is not a valid application number: its check digits do not match, so a digit was mistyped. Ask the borrower to read it again.`
    : refQuery ? `No application has the number ${refQuery.ref}.`
      : search ? 'No applications match this search and filter.' : 'No applications match.';
  syncKeyed($('#queue-body'), rows.map(r => ({ key: r.id, html: rowHtml(r, `<b>${esc(r.borrower)}</b><small class="cell-sub">${esc(r.email)}</small>`) })));
  setText($('#queue-status'), `${rows.length} application${rows.length === 1 ? '' : 's'} shown.`);
}

const openRow = target => {
  const row = target.closest('[data-open]');
  if (row) location.href = `/staff/applications/${row.dataset.open}`;
};
['#queue-body', '#admin-tests-body'].forEach(body => {
  $(body).addEventListener('click', e => openRow(e.target));
  $(body).addEventListener('keydown', e => { if (e.key === 'Enter') openRow(e.target); });
});

function queueError(message = '') {
  $('#queue-error').hidden = !message;
  if (message) setText($('#queue-error-text'), `${message} ${loaded ? 'The rows below are from the last successful load.' : ''}`.trim());
}

async function load() {
  const seq = ++loadSeq;
  loadAbort?.abort();
  const controller = new AbortController();
  loadAbort = controller;
  // Rows stay visible while loading; the empty message only ever follows a real, current answer.
  $('#queue-card').setAttribute('aria-busy', 'true');
  setBusy($('#queue-retry'), true);
  try {
    const params = new URLSearchParams({ status: filter, q: search });
    const data = await api('GET', `/api/staff/applications?${params}`, undefined, { signal: controller.signal });
    if (seq !== loadSeq) return;
    loaded = true;
    queueError();
    renderCounts(data.counts);
    renderRows(data.applications, data.ref_query);
    renderAdminTests(data.admin_tests);
  } catch (error) {
    if (seq !== loadSeq || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 404) showAuth();
    else {
      if (!loaded) $('#queue-empty').hidden = true;
      queueError(error.message);
    }
  } finally {
    if (seq === loadSeq) {
      loadAbort = null;
      $('#queue-card').removeAttribute('aria-busy');
      setBusy($('#queue-retry'), false);
    }
  }
}
$('#queue-retry').onclick = load;

$('#search').oninput = e => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(() => { search = value; load(); }, 250);
};

$('#auth-form').onsubmit = async e => {
  e.preventDefault();
  const form = e.target;
  const submit = $('#auth-submit');
  if (submit.disabled) return;
  $('#auth-error').hidden = true;
  setBusy(submit, true);
  try {
    const result = await api('POST', '/api/auth/login', { email: form.email.value.trim(), password: form.password.value });
    if (result.role !== 'lender') {
      await api('POST', '/api/auth/logout');
      throw new Error('This account is not a staff account. Borrowers sign in at the borrower portal.');
    }
    form.reset();
    await start();
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').hidden = false;
  } finally {
    setBusy(submit, false);
  }
};
$('#logout-btn').onclick = () => {
  clearTimeout(searchTimer);
  loadSeq += 1;
  loadAbort?.abort();
  setBusy($('#logout-btn'), true);
  logout();
};
window.addEventListener('pagehide', () => { clearTimeout(searchTimer); loadAbort?.abort(); });

const SIGNED_IN_ONLY = ['#user-chip', '#logout-btn', '#staff-nav'];

function showAuth(message = '') {
  clearTimeout(searchTimer);
  loadSeq += 1;
  loadAbort?.abort();
  loaded = false;
  $('#queue-view').hidden = true;
  $('#auth').hidden = false;
  SIGNED_IN_ONLY.forEach(s => { $(s).hidden = true; });
  $('#auth-error').textContent = message;
  $('#auth-error').hidden = !message;
}

async function start() {
  let me;
  try {
    me = await api('GET', '/api/auth/me');
  } catch (error) {
    // Not signed in is the normal case here; any other failure is said out loud on the form.
    showAuth(error.status === 401 ? '' : error.message);
    return;
  }
  if (me.role !== 'lender') {
    showAuth();   // a borrower session is simply not a staff session: show the plain sign-in form
    return;
  }
  $('#user-chip').querySelector('span').textContent = me.name;
  $('#user-chip').classList.add('local');
  SIGNED_IN_ONLY.forEach(s => { $(s).hidden = false; });
  $('#auth').hidden = true;
  $('#queue-view').hidden = false;
  await load();
}

buildControls();
start();
