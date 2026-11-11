import { $, $$, esc, icon, api, toast, fmtDate, fmtDateTime, fmtSize, checkPill, STATUS_TONES, initTheme, logout, patch, setText, syncKeyed, setBusy, rovingTabs, confirmDialog, resultCue } from '/common.js';

initTheme();

const SLOT_ICONS = { id: 'id', slip: 'file', bank: 'bank', other1: 'plus', other2: 'plus' };
const SLOT_LABELS = { id: 'ID card', slip: 'Salary slip', bank: 'Bank statement', other1: 'Other 1', other2: 'Other 2' };
const DOC_STATUS = {
  checking: ['info', 'clock', 'Checking…'],
  accepted: ['ok', 'check', 'Accepted'],
  reupload: ['warn', 'alert', 'Re-upload needed'],
};
const POLL_MS = 1500;
const POLL_MAX_MS = 12000;

let mode = 'login';
let signedIn = false;
let pickSlot = null;
let activeUploadSlot = 'id';
let current = null;
// One operation at a time: an upload, a removal or a submission. Each disables the other controls.
let busySlot = null;
let busyName = '';
let removingSlot = null;
let submitting = false;
let uploadError = null;   // { slot, file, message } of the last failed upload, kept for "Try again"
// Polling: one request in flight at most; a newer refresh cancels and outranks an older one.
let pollTimer = null;
let pollFailures = 0;
let refreshSeq = 0;
let refreshAbort = null;

const working = () => Boolean(busySlot || removingSlot || submitting);

// ---------------------------------------------------------------- auth
function setMode(next) {
  mode = next;
  $$('[data-auth]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.auth === mode)));
  $('#auth-form').setAttribute('aria-labelledby', `auth-tab-${mode}`);
  $('#name-row').hidden = mode !== 'register';
  $('#pw-hint').hidden = mode !== 'register';
  $('#auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
  $('#auth-form').password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('#auth-error').hidden = true;
}
$$('[data-auth]').forEach(b => { b.onclick = () => setMode(b.dataset.auth); });
rovingTabs($('.auth-tabs'), { activate: true });

$('#auth-form').onsubmit = async e => {
  e.preventDefault();
  const form = e.target;
  const submit = $('#auth-submit');
  if (submit.disabled) return;
  const body = { email: form.email.value.trim(), password: form.password.value };
  if (mode === 'register') body.name = form.name.value.trim();
  $('#auth-error').hidden = true;
  setBusy(submit, true);
  try {
    const result = await api('POST', mode === 'register' ? '/api/auth/register' : '/api/auth/login', body);
    if (result.role !== 'borrower') {
      await api('POST', '/api/auth/logout');
      throw new Error('This is a staff account. Staff use the internal staff sign-in, not the borrower portal.');
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
  stopPolling();
  signedIn = false;
  setBusy($('#logout-btn'), true);
  logout();
};

// ---------------------------------------------------------------- dashboard
// Processing pipeline (same stages the backend runs): pre-scan -> OCR -> PII masking -> LLM evaluation -> verification.
// Stage states come from the API only; while a run is in progress and a stage has no result yet it is shown as waiting.
const STAGES = [
  ['prescan', 'Pre-scan', 'scan'], ['ocr', 'OCR', 'text'], ['pii', 'PII masking', 'shield'],
  ['llm', 'LLM evaluation', 'sparkles'], ['verify', 'Verification', 'scale'],
];
function pipeline(app) {
  const byKey = Object.fromEntries((app.pipeline || []).map(s => [s.key, s]));
  const hasRun = (app.pipeline || []).length > 0;
  const checking = app.status === 'checking';
  const elapsed = checking && app.updated ? Math.max(0, Math.floor(Date.now() / 1000 - app.updated)) : 0;
  const elapsedText = elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`;
  setText($('#pipeline-note'), checking ? `Processing your documents (${elapsedText})`
    : hasRun ? `Last run ${fmtDateTime(app.updated)}` : 'Runs when you submit your documents for verification.');
  const card = $('.pipeline-card');
  if (checking) card.setAttribute('aria-busy', 'true');
  else card.removeAttribute('aria-busy');
  syncKeyed($('#pipeline'), STAGES.map(([key, label, glyph]) => {
    const stage = byKey[key];
    let cls = 'pending';
    let detail = '—';
    let mark = '';
    if (stage) {
      cls = stage.status;
      detail = stage.detail;
      mark = stage.status === 'done' ? icon('check') : stage.status === 'warn' ? icon('alert') : stage.status === 'fail' ? icon('x') : '';
    } else if (checking) {
      cls = 'waiting';
      detail = 'waiting for result';
    }
    return { key, html: `<li class="step ${esc(cls)}"><span class="step-icon">${icon(glyph)}</span><div class="step-body"><div class="step-title">${label}<span class="step-state">${mark}</span></div><div class="step-detail" title="${esc(detail)}">${esc(detail)}</div></div></li>` };
  }));
}

function banner(app) {
  const reupload = app.slots.filter(s => s.document?.status === 'reupload').length;
  const missing = app.slots.filter(s => s.missing).length;
  const attention = reupload + missing;
  const messages = {
    draft: ['', 'upload', 'Upload your documents and check each preview. When everything is right, submit for verification.'],
    checking: ['info', 'clock', 'Your documents are being processed. This page updates on its own; the elapsed time above shows how long this run has been in progress.'],
    action_needed: attention
      ? ['warn', 'alert', `${attention} document${attention === 1 ? ' needs' : 's need'} your attention. Replace ${attention === 1 ? 'it' : 'them'} below, then resubmit for verification.`]
      : ['info', 'upload', 'You replaced a document. Submit again to update your verification before the final decision.'],
    // Under review is reached with different check results; say which one, never "verified" for a mismatch.
    in_review: app.check?.status === 'Mismatch'
      ? ['warn', 'alert', `Your documents were checked and some details do not agree${app.check.reason ? `: ${app.check.reason.replace(/\s*Manual review is required\.$/, '')}` : '.'} Our team is reviewing your application and will tell you here if a new document is needed.`]
      : app.check?.status === 'Verified'
        ? ['info', 'shield', 'Your documents are submitted and verified. Our team is reviewing your application.']
        : ['info', 'shield', 'Your documents are submitted and have been checked. Our team is reviewing your application.'],
    approved: ['ok', 'check', 'Your documents have been approved.'],
    rejected: ['bad', 'x', `Your documents were not approved.${app.decision_reason ? ` Reason: ${app.decision_reason}` : ''}`],
  };
  const [tone, glyph, text] = messages[app.status];
  const el = $('#banner');
  const cls = `banner ${tone}`;
  if (el.className !== cls) el.className = cls;
  // Unchanged text is not rewritten, so the status region is announced once, not on every poll.
  patch(el, `${app.status === 'checking' ? '<span class="spinner"></span>' : icon(glyph)}<span>${esc(text)}</span>`);
}

function docStatus(app, d) {
  if (!d) return ['', 'minus', 'Not uploaded'];
  if (d.status === 'uploaded') return app.status === 'draft' ? ['info', 'check', 'Ready to submit'] : ['info', 'upload', 'New copy · resubmit to verify'];
  return DOC_STATUS[d.status] || ['', 'minus', d.status];
}

function docCard(app, slot) {
  const d = slot.document;
  const [tone, glyph, label] = docStatus(app, d);
  const attention = d?.status === 'reupload' || slot.missing;
  const uploading = busySlot === slot.slot;
  const removing = removingSlot === slot.slot;
  const locked = working() ? 'disabled' : '';
  const buttons = [];
  if (d?.status === 'accepted') buttons.push(`<button class="btn btn-ghost btn-sm" data-view="${slot.slot}" type="button">Preview</button>`);
  if (slot.can_upload) buttons.push(`<button class="btn btn-outline btn-sm" data-edit="${slot.slot}" type="button" ${locked}>Edit</button>`);
  if (slot.can_remove) buttons.push(`<button class="btn btn-ghost btn-sm danger-text" data-remove="${slot.slot}" type="button" ${locked} ${removing ? 'aria-busy="true"' : ''}>Cancel</button>`);
  const thumb = d && d.status !== 'accepted'
    ? `<button class="doc-thumb" data-view="${slot.slot}" type="button" title="View ${esc(noun(slot.title))}"><img src="/api/borrower/documents/${slot.slot}/preview?size=thumb&v=${d.version}" alt="Preview of your ${esc(noun(slot.title))}" loading="lazy"></button>`
    : `<span class="doc-row-icon ${d?.status === 'accepted' ? 'done' : ''}" aria-hidden="true">${icon(d?.status === 'accepted' ? 'check' : SLOT_ICONS[slot.slot])}</span>`;
  const reason = slot.missing
    ? `Required: upload your ${slot.slot === 'id' ? 'ID card' : 'salary slip'}, then resubmit.`
    : d?.reason && d.status === 'reupload' ? d.reason : '';
  const status = uploading
    ? `<span class="pill info"><span class="spinner"></span>Uploading ${esc(busyName)}…</span>`
    : `<span class="pill ${tone}">${icon(glyph)}${label}</span>${d ? `<span class="muted doc-meta" title="${d.filename ? esc(d.filename) + ' · ' : ''}${esc(d.kind.toUpperCase())} · ${fmtSize(d.size)} · version ${d.version} · ${fmtDateTime(d.uploaded)}">${d.filename ? `<b>${esc(d.filename)}</b> · ` : ''}${esc(d.kind.toUpperCase())} · ${fmtSize(d.size)} · version ${d.version} · ${fmtDateTime(d.uploaded)}</span>` : ''}`;
  return `<article class="doc-row ${attention ? 'attention' : ''}">
    ${thumb}
    <div class="doc-row-body">
      <div class="doc-row-head"><b>${esc(slot.title)}</b><span class="req ${slot.required ? 'required' : ''}">${slot.required ? 'Required' : 'Optional'}</span></div>
      <p class="doc-row-hint">${esc(slot.hint)}</p>
      <div class="doc-row-status">${status}</div>
      ${reason ? `<p class="doc-row-reason">${d?.requested_by_reviewer ? '<b>From our review team:</b> ' : ''}${esc(reason)}</p>` : ''}
    </div>
    <div class="doc-row-action">${buttons.join('')}</div>
  </article>`;
}

function renderUploadPanel(slots) {
  const available = slots.filter(s => s.can_upload);
  if (!available.some(s => s.slot === activeUploadSlot)) activeUploadSlot = available[0]?.slot || slots[0]?.slot;
  const active = slots.find(s => s.slot === activeUploadSlot);
  syncKeyed($('#upload-types'), slots.map(s => {
    const selected = s.slot === activeUploadSlot;
    const state = s.document ? (s.document.status === 'reupload' ? 'alert' : 'check') : '';
    const stateLabel = state === 'alert' ? ', re-upload needed' : state ? ', file attached' : '';
    return { key: s.slot, html: `<button class="upload-type ${selected ? 'selected' : ''}" type="button" data-upload-type="${s.slot}" aria-pressed="${selected}" aria-label="${SLOT_LABELS[s.slot]}${s.required ? ', required' : ''}${stateLabel}" ${!s.can_upload || working() ? 'disabled' : ''}><span class="upload-type-icon">${icon(SLOT_ICONS[s.slot])}</span><span>${SLOT_LABELS[s.slot]}${s.required ? '<small>Required</small>' : ''}</span>${state ? `<i class="upload-type-check ${state}">${icon(state)}</i>` : ''}</button>` };
  }));
  const doc = active?.document;
  const zone = $('#dropzone');
  const uploading = Boolean(busySlot);
  const decided = ['approved', 'rejected'].includes(current?.status);
  setText($('#drop-title'), uploading ? `Uploading ${busyName}…`
    : !active?.can_upload ? (decided ? 'Uploads are closed' : 'Nothing to upload right now')
      : doc ? `Replace ${active.title}` : `Drag and drop your ${active?.title || 'document'} here`);
  patch($('#drop-sub'), uploading ? `Sending your ${esc(noun(slotTitle(busySlot)))} over a one-time secure link. Keep this page open.`
    : active?.can_upload ? 'or <u>browse files</u> · PDF, PNG or JPG' : '');
  setText($('#upload-help'), active?.can_upload
    ? doc ? `This will replace version ${doc.version}. Older versions stay in your application history.`
      : `${active.required ? 'Required document' : 'Optional document'} · Maximum file size: 10 MB.`
    : decided ? 'Documents are locked after a final decision.'
      : 'No document can be added or replaced at this stage. You will see it here if our team asks for a new copy.');
  zone.disabled = !active?.can_upload || working();
  if (uploading) zone.setAttribute('aria-busy', 'true');
  else zone.removeAttribute('aria-busy');
  zone.setAttribute('aria-label', uploading ? `Uploading ${busyName}` : active?.can_upload ? `Choose a file for ${active.title}` : 'Document upload unavailable');
  const failed = uploadError && !uploading;
  $('#upload-error').hidden = !failed;
  if (failed) {
    setText($('#upload-error-text'), `${slotTitle(uploadError.slot)} was not uploaded. ${uploadError.message}`);
    $('#upload-retry').disabled = working() || !slots.find(s => s.slot === uploadError.slot)?.can_upload;
  }
  const required = slots.filter(s => s.required);
  setText($('#docs-progress'), required.length ? `${required.filter(s => s.document).length} of ${required.length} required attached · ` : '');
}

function submitBar(app) {
  const bar = $('#submit-bar');
  bar.hidden = !['draft', 'action_needed'].includes(app.status);
  if (bar.hidden) return;
  const again = app.resubmit;
  patch(bar, `<div class="submit-text">
      <b>${again ? 'Ready to resubmit?' : 'Ready to submit?'}</b>
      <p>${esc(app.submit_hint || '')}</p>
      <small>Submitting runs pre-scan, PDF text extraction or OCR, PII masking, optional LLM extraction when fields are missing, and verification. You can replace a document and resubmit before a final decision.</small>
    </div>
    <button class="btn btn-primary" id="submit-btn" type="button" ${app.can_submit && !working() ? '' : 'disabled'} ${submitting ? 'aria-busy="true"' : ''}>${again ? 'Resubmit for verification' : 'Submit for verification'}</button>`);
}

function render(app) {
  $('#test-bar').hidden = !app.test_account;
  if (app.test_account) $('#new-test-run').disabled = working() || app.status === 'checking';
  // A check that was running has just finished: mark the result with its sound.
  if (current?.status === 'checking' && app.status !== 'checking') resultCue(app.check?.status);
  current = app;
  // The number is the headline; its two check digits are marked (they are what catches a typo).
  const checked = app.ref.match(/^(NB-\d{4}-\d{6}-)(\d{2})$/);
  patch($('#app-ref'), `<small>Application number</small>${checked ? `${esc(checked[1])}<b title="Check digits">${esc(checked[2])}</b>` : esc(app.ref)}`);
  setText($('#app-dates'), `Started ${fmtDate(app.created)} · last updated ${fmtDateTime(app.updated)}`);
  const badge = $('#app-status');
  const badgeClass = `status-badge ${STATUS_TONES[app.status] || ''}`;
  if (badge.className !== badgeClass) badge.className = badgeClass;
  setText(badge, app.status_label);
  patch($('#app-check'), checkPill(app.check?.status));
  $$('#legend [data-check]').forEach(li => li.classList.toggle('active', li.dataset.check === app.check?.status));
  // A decided application carries its stamp; it lands once when the page opens or the decision arrives.
  const stamp = $('#decision-stamp');
  const final = app.status === 'approved' || app.status === 'rejected';
  if (final) {
    stamp.className = `stamp ${app.status === 'rejected' ? 'bad' : ''}`;
    patch(stamp, `<b>${app.status === 'approved' ? 'Approved' : 'Not approved'}</b><span>${esc(fmtDate(app.updated))} · ${esc(new Date(app.updated * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</span>`);
  }
  stamp.hidden = !final;
  pipeline(app);
  banner(app);
  const main = app.slots.filter(s => !s.slot.startsWith('other'));
  const others = app.slots.filter(s => s.slot.startsWith('other'));
  renderUploadPanel(app.slots);
  syncKeyed($('#doc-list'), [
    ...main.map(s => ({ key: s.slot, html: docCard(app, s) })),
    { key: 'subhead', html: '<div class="doc-subhead">Other related documents <span class="muted">(optional)</span></div>' },
    ...others.map(s => ({ key: s.slot, html: docCard(app, s) })),
  ]);
  submitBar(app);
  if (app.status === 'checking') schedulePoll(POLL_MS);
}

// Controls are re-rendered only when they change, so their handlers live on the stable containers.
$('#doc-list').addEventListener('click', e => {
  const button = e.target.closest('[data-view], [data-edit], [data-remove]');
  if (!button || button.disabled) return;
  if (button.dataset.view) viewDocument(button.dataset.view);
  else if (button.dataset.edit) chooseFile(button.dataset.edit);
  else removeDocument(button.dataset.remove);
});
$('#upload-types').addEventListener('click', e => {
  const button = e.target.closest('[data-upload-type]');
  if (!button || button.disabled || !current) return;
  activeUploadSlot = button.dataset.uploadType;
  renderUploadPanel(current.slots);
});
$('#submit-bar').addEventListener('click', e => { if (e.target.closest('#submit-btn')) submitApplication(); });
$('#dropzone').onclick = () => { if (activeUploadSlot) chooseFile(activeUploadSlot); };
$('#upload-retry').onclick = () => { if (uploadError) uploadFile(uploadError.slot, uploadError.file); };
$('#sync-retry').onclick = () => refresh();
// Administrator test account: open a fresh application for the next set of documents.
$('#new-test-run').onclick = async () => {
  const button = $('#new-test-run');
  if (working() || button.disabled || !current?.test_account) return;
  const confirmed = await confirmDialog({
    title: 'Start a new test run?',
    message: `This opens a fresh application with a new number. The current run (${current.ref}) is kept for the review team.`,
    confirmLabel: 'Start a new test run', cancelLabel: 'Stay on this run',
  });
  if (!confirmed || working()) return;
  if (current?.status === 'checking') { toast('The current test run is still being checked. Try again in a moment.'); return; }
  setBusy(button, true);
  try {
    stopPolling();
    const app = await api('POST', '/api/borrower/test-runs');
    uploadError = null;
    activeUploadSlot = 'id';
    current = null;          // a different application: nothing carries over, and no result sound
    render(app);
    window.scrollTo({ top: 0 });
    toast(`New test run ${app.ref} is ready for documents.`);
  } catch (error) {
    toast(error.message);
    await settle();
  } finally {
    setBusy(button, false);
    if (current) render(current);
  }
};
$('#copy-ref').onclick = async () => {
  if (!current?.ref) return;
  try {
    await navigator.clipboard.writeText(current.ref);
    toast(`Application number ${current.ref} copied.`);
  } catch {
    toast(`Your application number is ${current.ref}.`);
  }
};

function chooseFile(slot) {
  if (working()) return;
  pickSlot = slot;
  $('#file-input').click();
}

// ---------------------------------------------------------------- refresh + polling
function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  refreshAbort?.abort();
  refreshAbort = null;
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (!signedIn || document.hidden) return;   // resumes from visibilitychange
  pollTimer = setTimeout(refresh, delay);
}

function syncNote(message) {
  $('#sync-note').hidden = !message;
  if (message) setText($('#sync-text'), message);
}

// Returns true when fresh data was rendered. A newer call supersedes an older one in flight.
async function refresh() {
  stopPolling();
  const seq = ++refreshSeq;
  const controller = new AbortController();
  refreshAbort = controller;
  setBusy($('#sync-retry'), true);
  try {
    const app = await api('GET', '/api/borrower/application', undefined, { signal: controller.signal });
    if (seq !== refreshSeq || !signedIn) return false;
    pollFailures = 0;
    syncNote('');
    render(app);
    return true;
  } catch (error) {
    if (seq !== refreshSeq || error.name === 'AbortError') return false;
    if (error.status === 401) { showAuth(); return false; }
    if (!current) throw error;
    // Keep what is on screen, say so, and keep trying while a check is running.
    pollFailures += 1;
    const retrying = current.status === 'checking';
    syncNote(`${error.message} ${retrying ? 'Showing the last known status and retrying automatically.' : 'Showing the last known status.'}`);
    if (retrying) schedulePoll(Math.min(POLL_MAX_MS, POLL_MS * 2 ** pollFailures));
    return false;
  } finally {
    if (seq === refreshSeq) {
      refreshAbort = null;
      setBusy($('#sync-retry'), false);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollTimer); pollTimer = null; }
  else if (signedIn && current?.status === 'checking' && !refreshAbort) refresh();
});
window.addEventListener('pagehide', stopPolling);

const slotTitle = slot => current?.slots.find(s => s.slot === slot)?.title || 'document';
const noun = title => (title.startsWith('ID') ? title : title.toLowerCase());  // 'ID card' keeps its capitals

// ---- preview before upload ----
async function checkFile(file) {
  if (!file.size || file.size > 10 * 1024 * 1024) return 'Each file must contain data and be no larger than 10 MB.';
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pdf = String.fromCharCode(...head.slice(0, 5)) === '%PDF-';
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => head[i] === v);
  const jpg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (!pdf && !png && !jpg) return 'Unsupported file. Choose a PDF, PNG or JPEG.';
  return null;
}

async function confirmUpload(slot, file) {
  const problem = await checkFile(file);
  if (problem) return toast(problem);
  const url = URL.createObjectURL(file);
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = `Upload as your ${noun(slotTitle(slot))}?`;
  $('#confirm-meta').textContent = `${file.name} · ${fmtSize(file.size)}`;
  $('#confirm-preview').innerHTML = isPdf
    ? `<iframe src="${url}#toolbar=0&view=FitH" title="Preview of ${esc(file.name)}"></iframe>`
    : `<img src="${url}" alt="Preview of ${esc(file.name)}">`;
  const close = () => { dialog.close(); $('#confirm-preview').innerHTML = ''; URL.revokeObjectURL(url); };
  $('#confirm-upload').onclick = () => { close(); uploadFile(slot, file); };
  $('#confirm-other').onclick = () => { close(); chooseFile(slot); };
  $('#confirm-cancel').onclick = close;
  dialog.onclose = () => { $('#confirm-preview').innerHTML = ''; URL.revokeObjectURL(url); };
  dialog.showModal();
}

// ---- larger view of an uploaded document ----
function viewDocument(slot) {
  const d = current?.slots.find(s => s.slot === slot)?.document;
  if (!d) return;
  $('#view-title').textContent = `${slotTitle(slot)} · version ${d.version}`;
  $('#view-body').innerHTML = `<img src="/api/borrower/documents/${slot}/preview?size=large&v=${d.version}" alt="Your ${esc(noun(slotTitle(slot)))}, page 1">`;
  const slotState = current.slots.find(s => s.slot === slot);
  $('#view-cancel').onclick = () => $('#view-dialog').close();
  const edit = $('#view-edit');
  edit.hidden = !slotState?.can_upload;
  edit.onclick = () => {
    $('#view-dialog').close();
    chooseFile(slot);
  };
  $('#view-dialog').showModal();
}
$('#view-close').onclick = () => $('#view-dialog').close();

// Secure upload: 1) request a one-time link, 2) PUT the file straight to it. No verification yet.
async function uploadFile(slot, file) {
  if (working()) return;
  busySlot = slot;
  busyName = file.name;
  uploadError = null;
  render(current);
  try {
    const link = await api('POST', '/api/borrower/upload-links', { slot });
    let response;
    try {
      response = await fetch(link.upload_url, { method: link.method, body: file, headers: { 'x-nb-csrf': '1', 'content-type': 'application/octet-stream', 'x-nb-filename': encodeURIComponent(file.name) }, credentials: 'same-origin' });
    } catch {
      throw new Error('The connection dropped while sending the file. Please try again.');
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(typeof failure.detail === 'string' ? failure.detail : 'Upload failed. Please try again.');
    }
    toast(`${slotTitle(slot)} uploaded securely. Submit for verification when you are ready.`);
  } catch (error) {
    uploadError = { slot, file, message: error.message };
    toast(`${slotTitle(slot)} was not uploaded.`);
  } finally {
    busySlot = null;
    busyName = '';
    await settle();
  }
}

// After an operation: fetch the new state, or at least redraw the controls it had disabled.
async function settle() {
  if (!(await refresh()) && signedIn && current) render(current);
}

async function removeDocument(slot) {
  if (working()) return;
  const confirmed = await confirmDialog({
    title: `Remove this ${noun(slotTitle(slot))}?`,
    message: `Cancel this ${noun(slotTitle(slot))}? Its current file will be removed from your application.`,
    confirmLabel: 'Remove file', cancelLabel: 'Keep file', danger: true,
  });
  if (!confirmed || working()) return;
  removingSlot = slot;
  render(current);
  try {
    await api('DELETE', `/api/borrower/documents/${slot}`);
    toast(`${slotTitle(slot)} removed.`);
  } catch (error) {
    toast(error.message);
  } finally {
    removingSlot = null;
    await settle();
  }
}

async function submitApplication() {
  if (working() || !current?.can_submit) return;
  const again = current.resubmit;
  const confirmed = await confirmDialog({
    title: again ? 'Resubmit for verification?' : 'Submit for verification?',
    message: again ? 'Resubmit your documents for verification?' : 'Submit your documents for verification? You can replace a document and resubmit before a final decision.',
    confirmLabel: again ? 'Resubmit for verification' : 'Submit for verification', cancelLabel: 'Not yet',
  });
  if (!confirmed || working()) return;
  submitting = true;
  render(current);
  try {
    await api('POST', '/api/borrower/submit');
    toast('Submitted. Verifying your documents…');
  } catch (error) {
    toast(error.message);
  } finally {
    submitting = false;
    await settle();
  }
}

$('#file-input').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  const slot = pickSlot;
  pickSlot = null;
  if (file && slot) confirmUpload(slot, file);
};

$('#dropzone').addEventListener('dragover', e => { e.preventDefault(); if (!$('#dropzone').disabled) $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', e => {
  e.preventDefault();
  $('#dropzone').classList.remove('dragging');
  if ($('#dropzone').disabled || working()) return;
  const file = e.dataTransfer?.files?.[0];
  if (file && activeUploadSlot) confirmUpload(activeUploadSlot, file);
});

// ---------------------------------------------------------------- boot
function pageState(kind, message = '') {
  const panel = $('#page-state');
  panel.hidden = kind === 'ready';
  if (panel.hidden) return;
  const failed = kind === 'error';
  $('#page-state-spinner').hidden = failed;
  $('#page-state-title').textContent = failed ? 'We could not load your application' : 'Loading your application…';
  $('#page-state-text').textContent = message;
  $('#page-state-text').hidden = !message;
  $('#page-state-retry').hidden = !failed;
}
$('#page-state-retry').onclick = start;

function showAuth() {
  stopPolling();
  signedIn = false;
  current = null;
  uploadError = null;
  pageState('ready');
  $('#dashboard').hidden = true;
  $('#auth').hidden = false;
  $('#user-chip').hidden = true;
  $('#logout-btn').hidden = true;
}

async function start() {
  $('#auth').hidden = true;
  $('#dashboard').hidden = true;
  pageState('loading');
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.role !== 'borrower') {
      await api('POST', '/api/auth/logout');
      showAuth();
      return;
    }
    signedIn = true;
    $('#user-chip').hidden = false;
    $('#user-chip').querySelector('span').textContent = me.name;
    $('#user-chip').classList.add('local');
    $('#logout-btn').hidden = false;
    if (!(await refresh())) return;   // 401 already switched to the sign-in form
    pageState('ready');
    $('#dashboard').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (error) {
    // Only "not signed in" leads to the sign-in form; anything else is reported with a retry.
    if (error.status === 401) showAuth();
    else pageState('error', error.message);
  }
}

setMode('login');
start();
