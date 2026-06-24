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

// ── tiny inline markdown renderer (bold, lists, tables only) ───────────────

function renderMarkdown(text) {
  let html = escapeHtml(text);

  // bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // unordered lists: lines starting with - or * followed by space
  html = html.replace(/^([ \t]*)[-*] (.+)$/gm, '$1<li>$2</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // ordered lists: lines starting with 1. 2. etc.
  html = html.replace(/^([ \t]*)\d+\. (.+)$/gm, '$1<li>$2</li>');

  // tables: pipe-delimited rows
  if (html.includes('|')) {
    html = html.replace(/^(\|.+\|)$/gm, (row) => {
      const cells = row.split('|').filter(c => c.trim() !== '');
      const isHeader = /^[\s:-]+$/.test(cells[0] || '');
      if (isHeader) return ''; // skip separator row
      const tag = /^[-=]+$/.test(row.replace(/\|/g, '').trim()) ? '' : 'td';
      const firstRow = !html.includes('<table>');
      const cellTag = firstRow ? 'th' : 'td';
      return '<tr>' + cells.map(c => `<${cellTag}>${c.trim()}</${cellTag}>`).join('') + '</tr>';
    });
    html = html.replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>');
  }

  return html;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── bubble rendering ────────────────────────────────────────────────────────

function bubble(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'agent') {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── server communication ────────────────────────────────────────────────────

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
