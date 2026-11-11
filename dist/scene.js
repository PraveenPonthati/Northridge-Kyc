// Sign-in scenes: small looping illustrations with invented people. Decorative only (the stage is
// aria-hidden), paused while the page or the sign-in view is hidden, and static under reduced motion.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const showing = el => !document.hidden && el.offsetParent !== null;
async function whenShowing(el) { while (!showing(el)) await sleep(400); }

async function type(el, text) {
  if (still) { el.textContent = text; return; }
  el.classList.add('typing');
  for (let i = 1; i <= text.length; i++) { el.textContent = text.slice(0, i); await sleep(36); }
  el.classList.remove('typing');
}
function put(el, text) {
  el.textContent = text;
  el.classList.remove('pop');
  void el.offsetWidth;          // restart the entrance
  el.classList.add('pop');
}
function stamp(slot, good, label) {
  const mark = document.createElement('div');
  mark.className = `stamp${good ? '' : ' bad'}`;
  const word = document.createElement('b');
  word.textContent = label;
  mark.append(word);
  slot.replaceChildren(mark);
}

// ---- borrower: three documents fill in for one applicant, then a decision lands
const APPLICANTS = [
  { name: 'Aoife Byrne', id: 'IE 4821 907', pay: '\u20ac3,420.00', good: true },
  { name: 'Cian O\u2019Sullivan', id: 'IE 7305 118', pay: '\u20ac2,980.00', slip: 'Cillian O\u2019Sullivan', good: false },
  { name: 'Niamh Kelly', id: 'IE 2196 554', pay: '\u20ac4,150.00', good: true },
  { name: 'Ois\u00edn Murphy', id: 'IE 6042 331', pay: '\u20ac3,760.00', credit: '\u20ac2,910.00', good: false },
  { name: 'Saoirse Walsh', id: 'IE 3578 260', pay: '\u20ac3,090.00', good: true },
  { name: 'Eoin Doyle', id: 'IE 9113 472', pay: '\u20ac5,200.00', good: true },
];
async function documents(stage) {
  const f = key => stage.querySelector(`[data-f="${key}"]`);
  const fields = [...stage.querySelectorAll('[data-f]')];
  const slot = stage.querySelector('.stage-stamp');
  for (let i = 0; ; i = (i + 1) % APPLICANTS.length) {
    await whenShowing(stage);
    const p = APPLICANTS[i];
    fields.forEach(el => { el.textContent = ''; });
    slot.replaceChildren();
    stage.classList.remove('clearing');
    await type(f('id-name'), p.name);
    put(f('id-no'), p.id);
    await sleep(260);
    await type(f('slip-name'), p.slip || p.name);
    put(f('slip-net'), p.pay);
    await sleep(260);
    await type(f('bank-name'), p.name);
    put(f('bank-credit'), p.credit || p.pay);
    await sleep(520);
    stamp(slot, p.good, p.good ? 'Approved' : 'Rejected');
    if (still) return;
    await sleep(2600);
    stage.classList.add('clearing');
    await sleep(460);
  }
}

// ---- staff: applications arrive in a queue and are decided one by one
const QUEUE = [
  ['R\u00f3is\u00edn Gallagher', 'ok', 'Approved'], ['P\u00e1draig Nolan', 'warn', 'Needs review'], ['Siobh\u00e1n Kennedy', 'ok', 'Approved'],
  ['Darragh Brennan', 'bad', 'Rejected'], ['Caoimhe Ryan', 'ok', 'Approved'], ['Fionn McCarthy', 'ok', 'Approved'],
  ['Gr\u00e1inne Fitzgerald', 'warn', 'Needs review'], ['Tadhg O\u2019Connor', 'ok', 'Approved'], ['Orla Quinn', 'bad', 'Rejected'],
  ['Conor Healy', 'ok', 'Approved'], ['M\u00e1ire Lynch', 'ok', 'Approved'], ['Ruair\u00ed Daly', 'warn', 'Needs review'],
];
function chip(tone, text) {
  const el = document.createElement('span');
  el.className = `pill ${tone}`;
  el.textContent = text;
  return el;
}
async function queue(stage) {
  const list = stage.querySelector('.desk-rows');
  for (let start = 0; ; start = (start + 4) % QUEUE.length) {
    await whenShowing(stage);
    list.replaceChildren();
    stage.classList.remove('clearing');
    const rows = QUEUE.slice(start, start + 4).map(([name, tone, verdict], i) => {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.textContent = name;
      const ref = document.createElement('span');
      ref.className = 'desk-ref';
      ref.textContent = `NB-2611-${String(104729 * (start + i + 3) % 900000 + 100000)}`;
      li.append(who, ref, chip('', 'Waiting'));
      return { li, tone, verdict };
    });
    for (const row of rows) { list.append(row.li); if (!still) await sleep(300); }
    if (!still) await sleep(500);
    for (const row of rows) {
      row.li.classList.add('active');
      row.li.lastChild.replaceWith(chip('info', 'Checking\u2026'));
      if (!still) await sleep(820);
      row.li.lastChild.replaceWith(chip(row.tone, row.verdict));
      row.li.classList.remove('active');
      if (!still) await sleep(260);
    }
    if (still) return;
    await sleep(2400);
    stage.classList.add('clearing');
    await sleep(460);
  }
}

const stage = document.querySelector('.doc-stage[data-scene]');
if (stage) ({ documents, queue })[stage.dataset.scene]?.(stage);
