// Minimal chat client. Talks to the server routes; renders the transcript and
// the live observation trail. No framework on purpose — the brief asks to keep
// the front end minimal and spend effort on the harness.

const log = document.getElementById('log');
const events = document.getElementById('events');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const downloadBox = document.getElementById('download');
const dl = document.getElementById('dl');

let sessionId = null;
let lastSeq = 0;

function bubble(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function pollTrace() {
  if (!sessionId) return;
  const res = await fetch(`/api/session/${sessionId}/trace?since=${lastSeq}`);
  if (!res.ok) return;
  const { events: evs } = await res.json();
  for (const e of evs) {
    lastSeq = Math.max(lastSeq, e.seq + 1);
    const div = document.createElement('div');
    div.className = 'ev';
    div.innerHTML = `<span class="t">${e.type}</span> · ${escapeHtml(e.summary)}`;
    events.appendChild(div);
  }
  events.scrollTop = events.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function handleTurn(data) {
  bubble('agent', data.reply);
  if (data.canDownload) {
    downloadBox.style.display = 'block';
    dl.href = `/api/session/${sessionId}/form`;
  }
  pollTrace();
}

async function start() {
  const res = await fetch('/api/session', { method: 'POST' });
  const data = await res.json();
  sessionId = data.sessionId;
  handleTurn(data);
  setInterval(pollTrace, 1500);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message || !sessionId) return;
  bubble('user', message);
  input.value = '';
  const res = await fetch(`/api/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (res.ok) handleTurn(data);
  else bubble('agent', `⚠ ${data.error ?? 'something went wrong'}`);
});

// ── W-2 PDF upload ──────────────────────────────────────────────────────────
const fileInput = document.getElementById('w2file');
const uploadBtn = document.getElementById('uploadBtn');
const sampleBtn = document.getElementById('sampleBtn');

async function uploadPdf(bytes, filename) {
  if (!sessionId) return;
  bubble('user', `📄 ${filename}`);
  const res = await fetch(`/api/session/${sessionId}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
  });
  const data = await res.json();
  if (res.ok) handleTurn(data);
  else bubble('agent', `⚠ ${data.error ?? 'upload failed'}`);
}

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) { bubble('agent', 'Pick a PDF first, then click Upload.'); return; }
  const buf = await file.arrayBuffer();
  await uploadPdf(buf, file.name);
  fileInput.value = '';
});

sampleBtn.addEventListener('click', async () => {
  const res = await fetch('/sample-w2.pdf');
  const buf = await res.arrayBuffer();
  await uploadPdf(buf, 'Sample-W2.pdf');
});

start();
