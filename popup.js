const $ = (id) => document.getElementById(id);
const EXAMPLE = `^CircularArray\\.java$
-- E remove\\(int
-- E remove\\(\\)
-- void insert\\(E
^PriorityCircularArray\\.java$
-- void insert\\(E
-- E remove\\(\\)`;

function validate(text) {
  const errors = [];
  let files = 0, steps = 0, cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const isMethod = line.startsWith('--');
    const src = isMethod ? line.replace(/^--\s*/, '') : line;
    try {
      const m = src.match(/^\/(.*)\/([dgimsuvy]*)$/);
      m ? new RegExp(m[1], m[2]) : new RegExp(src);
    } catch (e) { errors.push(`Line ${i + 1}: ${e.message}`); return; }
    if (isMethod) {
      if (!cur) errors.push(`Line ${i + 1}: method before any filename`);
      else { cur.methods++; steps++; }
    } else {
      if (cur && cur.methods === 0) steps++;
      cur = { methods: 0 }; files++;
    }
  });
  if (cur && cur.methods === 0) steps++;
  return { errors, files, steps };
}

function setStatus(msg, cls) { const s = $('status'); s.textContent = msg; s.className = cls || ''; }

chrome.storage.local.get({ config: '', hotkey: '\\', enabled: true, containerSelector: '' }, (s) => {
  $('config').value = s.config;
  $('hotkey').value = s.hotkey;
  $('enabled').checked = s.enabled;
  $('container').value = s.containerSelector;
});

$('example').addEventListener('click', () => { $('config').value = EXAMPLE; setStatus(''); });

$('save').addEventListener('click', () => {
  const config = $('config').value;
  const v = validate(config);
  if (v.errors.length) { setStatus(v.errors[0], 'err'); return; }
  const hotkey = $('hotkey').value || '\\';
  chrome.storage.local.set(
    { config, hotkey, enabled: $('enabled').checked, containerSelector: $('container').value.trim() },
    () => setStatus(`Saved: ${v.files} file${v.files === 1 ? '' : 's'}, ${v.steps} step${v.steps === 1 ? '' : 's'}`, 'ok')
  );
});
