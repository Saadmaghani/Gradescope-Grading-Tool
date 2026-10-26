(() => {
  'use strict';
  if (window.__gsNavLoaded) return;
  window.__gsNavLoaded = true;

  const DEFAULTS = { config: '', hotkey: '\\', enabled: true, containerSelector: '' };
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const CODE_SELECTOR = [
    'pre', 'code',
    '[class*="code" i]', '[class*="highlight" i]', '[class*="hljs"]',
    '[class*="CodeMirror"]', '[class*="monaco" i]',
    '[class*="fileViewer" i]', '[class*="file-viewer" i]'
  ].join(',');
  const CLICKABLE = 'a,button,summary,[role="button"],[role="tab"],[tabindex],li';

  let settings = { ...DEFAULTS };
  let plan = { files: [], steps: [], errors: [] };
  let pos = 0;                 // index of the next step to run
  let current = null;          // { fi, key, label } of the file we believe is open
  const believedOpen = new Map(); // key -> boolean, used when the DOM gives no expanded/selected signal
  let busy = false;
  let lastUrl = location.href;

  /* ---------- config parsing ---------- */

  function toRegExp(src, defaultFlags) {
    const m = src.match(/^\/(.*)\/([dgimsuvy]*)$/);
    if (m) return new RegExp(m[1], m[2].replace(/[gy]/g, ''));
    return new RegExp(src, defaultFlags);
  }

  function parseConfig(text) {
    const files = [];
    const errors = [];
    let cur = null;
    (text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      try {
        if (line.startsWith('--')) {
          const src = line.replace(/^--\s*/, '');
          if (!cur) { errors.push(`Line ${i + 1}: method before any filename`); return; }
          if (src) cur.methods.push({ src, re: toRegExp(src, 'm') });
        } else {
          cur = { src: line, re: toRegExp(line, 'i'), methods: [] };
          files.push(cur);
        }
      } catch (e) {
        errors.push(`Line ${i + 1}: ${e.message}`);
      }
    });
    const steps = [];
    files.forEach((f, fi) => {
      if (f.methods.length === 0) steps.push({ fi, mi: -1 });
      else f.methods.forEach((_, mi) => steps.push({ fi, mi }));
    });
    return { files, steps, errors };
  }

  function rebuild() {
    plan = parseConfig(settings.config);
    resetState();
    if (plan.errors.length) console.warn('[GS Nav] config errors:', plan.errors);
  }

  function resetState() {
    pos = 0;
    current = null;
    believedOpen.clear();
    clearHighlight();
  }

  /* ---------- small helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function waitFor(fn, timeout = 1800, step = 100) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        let v = null;
        try { v = fn(); } catch (e) { console.warn('[GS Nav]', e); }
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(tick, step);
      })();
    });
  }

  const isVisible = (el) => el.getClientRects().length > 0;

  /* ---------- toast ---------- */

  let toastEl = null, toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'gsnav-toast';
      Object.assign(toastEl.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647,
        maxWidth: '420px', padding: '8px 12px', borderRadius: '6px',
        font: '13px/1.35 system-ui, sans-serif', color: '#fff',
        boxShadow: '0 2px 10px rgba(0,0,0,.35)', pointerEvents: 'none',
        transition: 'opacity .25s'
      });
      document.documentElement.appendChild(toastEl);
    }
    toastEl.style.background = kind === 'err' ? '#b3261e' : '#1f2933';
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
  }

  /* ---------- finding files ---------- */

  function submissionPaths() {
    try {
      const el = document.querySelector('[data-react-class="SubmissionGrader"]');
      if (!el) return [];
      const props = JSON.parse(el.getAttribute('data-react-props'));
      return (props.files || []).map((f) => f.path).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function resolveFile(f) {
    const path = submissionPaths().find((p) => f.re.test(p)) || null;
    return { path, key: path || f.src, label: path || f.src, re: f.re };
  }

  function allElements() {
    return Array.from(document.body.querySelectorAll('*')).filter(
      (el) => !SKIP_TAGS.has(el.tagName) && !el.closest('#gsnav-toast, pre, code') && isVisible(el)
    );
  }

  function findHeader(target) {
    const els = allElements();
    const pick = (matcher) => {
      const hits = [];
      for (const el of els) {
        const t = norm(el.textContent);
        if (!t || t.length > 160 || !matcher(t)) continue;
        hits.push({ el, len: t.length });
      }
      if (!hits.length) return null;
      // prefer the tightest element (shortest text), earliest in the document
      const min = Math.min(...hits.map((h) => h.len));
      const best = hits.find((h) => h.len === min) || hits[0];
      return best.el.closest(CLICKABLE) || best.el;
    };

    if (target.path) {
      const names = [target.path, target.path.split('/').pop()];
      for (const n of names) {
        const b = new RegExp('(^|[^\\w.-])' + escapeRe(n) + '(?![\\w])');
        const hit = pick((t) => b.test(t));
        if (hit) return hit;
      }
    }
    return pick((t) => target.re.test(t));
  }

  function expandedState(header) {
    let el = header;
    for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
      for (const attr of ['aria-expanded', 'aria-selected']) {
        const v = el.getAttribute(attr);
        if (v === 'true') return true;
        if (v === 'false') return false;
      }
    }
    return null; // unknown
  }

  function believesOpen(header, key) {
    const s = expandedState(header);
    return s !== null ? s : believedOpen.get(key) === true;
  }

  async function closeFile(cur) {
    const header = findHeader(cur.target);
    if (!header) return;
    if (believesOpen(header, cur.target.key)) {
      header.click();
      believedOpen.set(cur.target.key, false);
      await sleep(150);
    }
  }

  /* ---------- finding methods in the rendered code ---------- */

  function codeRoots() {
    if (settings.containerSelector) {
      try {
        const custom = Array.from(document.querySelectorAll(settings.containerSelector)).filter(isVisible);
        if (custom.length) return custom;
      } catch (e) { /* bad selector: fall through */ }
    }
    let list = Array.from(document.querySelectorAll(CODE_SELECTOR)).filter(
      (el) => isVisible(el) && !el.closest('#gsnav-toast, nav')
    );
    list = list.filter((el) => !list.some((o) => o !== el && o.contains(el))); // outermost only
    if (list.length) return list;
    const main = document.getElementById('main-content');
    return main ? [main] : [document.body];
  }

  function blockOf(el, cache) {
    const chain = [];
    let cur = el, res;
    while (cur) {
      if (cache.has(cur)) { res = cache.get(cur); break; }
      chain.push(cur);
      const d = getComputedStyle(cur).display;
      if (!(d.startsWith('inline') || d === 'contents')) { res = cur; break; }
      cur = cur.parentElement;
    }
    if (!res) res = document.body;
    chain.forEach((c) => cache.set(c, res));
    return res;
  }

  function buildIndex(root) {
    const cache = new Map();
    const segs = [];
    let text = '';
    let lastBlock = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (!v) continue;
      const b = blockOf(n.parentElement, cache);
      if (lastBlock && b !== lastBlock && !text.endsWith('\n')) text += '\n';
      lastBlock = b;
      segs.push({ node: n, start: text.length, end: text.length + v.length });
      text += v;
    }
    return { text, segs };
  }

  function locate(segs, i, isEnd) {
    for (const s of segs) {
      if (isEnd ? (i > s.start && i <= s.end) : (i >= s.start && i < s.end)) {
        return { node: s.node, offset: i - s.start };
      }
    }
    if (!isEnd) {
      const next = segs.find((s) => s.start >= i);
      if (next) return { node: next.node, offset: 0 };
    }
    return null;
  }

  function findMatch(re) {
    const g = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'g');
    for (const root of codeRoots()) {
      const { text, segs } = buildIndex(root);
      g.lastIndex = 0;
      let m;
      while ((m = g.exec(text))) {
        if (m[0] === '') { g.lastIndex++; continue; }
        const a = locate(segs, m.index, false);
        const b = locate(segs, m.index + m[0].length, true);
        if (a && b) {
          const range = document.createRange();
          range.setStart(a.node, a.offset);
          range.setEnd(b.node, b.offset);
          if (range.getClientRects().length > 0) return { range };
        }
      }
    }
    return null;
  }

  /* ---------- reveal ---------- */

  const styleEl = document.createElement('style');
  styleEl.textContent = '::highlight(gsnav){background:#ffe066;color:#111}';
  document.documentElement.appendChild(styleEl);
  let fallbackEl = null, fallbackPrev = '';

  function clearHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('gsnav');
    if (fallbackEl) { fallbackEl.style.outline = fallbackPrev; fallbackEl = null; }
  }

  function reveal(hit) {
    clearHighlight();
    const el = hit.range.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    if (window.CSS && CSS.highlights && typeof Highlight !== 'undefined') {
      CSS.highlights.set('gsnav', new Highlight(hit.range));
    } else if (el) {
      fallbackEl = el; fallbackPrev = el.style.outline;
      el.style.outline = '2px solid #f5a623';
    }
  }

  /* ---------- stepping ---------- */

  async function runStep(step) {
    const f = plan.files[step.fi];
    const target = resolveFile(f);
    const method = step.mi >= 0 ? f.methods[step.mi] : null;
    const tag = `[${pos + 1}/${plan.steps.length}] ${target.label}${method ? ' › ' + method.src : ''}`;
    const switching = !current || current.fi !== step.fi;
    let header = null;
    let maybeToggled = false;   // true when we can't be sure the file is open and may need to toggle it

    if (switching) {
      if (current) await closeFile(current);
      current = null;
      header = findHeader(target);
      if (!header) { toast(`${tag}: couldn't find the file header on the page`, 'err'); return; }
      if (!believesOpen(header, target.key)) {
        header.click();
        believedOpen.set(target.key, true);
      }
      current = { fi: step.fi, target };
      maybeToggled = true;
      await sleep(150);
    } else {
      // Same file as last step. The user may have closed it by hand, so check first.
      header = findHeader(target);
      if (header) {
        const st = expandedState(header);
        if (st === false) {
          header.click();
          believedOpen.set(target.key, true);
          await sleep(150);
        } else if (st === null) {
          maybeToggled = true;   // unknown state: verify by looking for the method
        }
      }
    }

    if (!method) {
      (header || findHeader(target))?.scrollIntoView({ block: 'start' });
      toast(tag);
      return;
    }

    // When the state is unknown and the file was already open, give it a short first look.
    let hit = await waitFor(() => findMatch(method.re), switching ? 1800 : 600);
    if (!hit && maybeToggled) {
      // Our idea of open/closed was probably wrong. Toggle once and look again.
      header = findHeader(target) || header;
      if (header) {
        header.click();
        believedOpen.set(target.key, !believedOpen.get(target.key));
        hit = await waitFor(() => findMatch(method.re), 1800);
        if (!hit) {                      // still nothing: put the file back how it was
          header = findHeader(target) || header;
          header.click();
          believedOpen.set(target.key, !believedOpen.get(target.key));
        }
      }
    }
    if (hit) { reveal(hit); toast(tag); }
    else toast(`${tag}: no match in the visible code`, 'err');
  }

  async function advance() {
    if (busy || !plan.steps.length) return;
    busy = true;
    try {
      if (location.href !== lastUrl) { lastUrl = location.href; resetState(); }
      await runStep(plan.steps[pos]);
      pos = (pos + 1) % plan.steps.length;
    } catch (e) {
      console.error('[GS Nav]', e);
      toast('Error: ' + e.message, 'err');
    } finally {
      busy = false;
    }
  }


  /* ---------- diagnostics (Ctrl + hotkey) ---------- */

  const trunc = (str, n) => (str.length > n ? str.slice(0, n) + '…' : str);
  function describe(el) {
    const cls = typeof el.className === 'string' ? el.className.trim().replace(/\s+/g, '.') : '';
    return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> "${trunc(norm(el.textContent), 60)}"`;
  }

  async function diagnostics() {
    const out = [];
    out.push(`GS Nav v0.2 diagnostics`);
    out.push(`url: ${location.href}`);
    out.push(`steps: ${plan.steps.length}; config errors: ${plan.errors.join('; ') || 'none'}`);
    const paths = submissionPaths();
    out.push(`file paths in page data: ${JSON.stringify(paths)}`);

    plan.files.forEach((f) => {
      const t = resolveFile(f);
      const h = findHeader(t);
      out.push(`\nfile regex ${f.src} -> ${t.label}`);
      out.push(h ? `  header found: ${describe(h)}` : '  header NOT FOUND');
      if (h) {
        out.push(`  expanded state: ${expandedState(h)}`);
        out.push(`  header HTML: ${trunc(h.outerHTML, 500)}`);
        if (h.parentElement) out.push(`  parent HTML: ${trunc(h.parentElement.outerHTML, 900)}`);
      }
    });

    const names = paths.map((p) => p.split('/').pop());
    const withName = allElements().filter((el) => {
      const t = norm(el.textContent);
      return t && t.length < 160 && names.some((n) => t.includes(n));
    });
    out.push(`\nelements whose text contains a filename (${withName.length}):`);
    withName.slice(0, 8).forEach((el) => out.push(`  ${describe(el)}\n    ${trunc(el.outerHTML, 300)}`));

    const roots = codeRoots();
    out.push(`\ncode roots (${roots.length}):`);
    roots.slice(0, 5).forEach((r) => out.push(`  ${describe(r)}`));
    if (roots[0]) {
      const idx = buildIndex(roots[0]);
      out.push(`  text length ${idx.text.length}; sample: ${JSON.stringify(trunc(idx.text, 300))}`);
    }

    const classes = new Set();
    document.querySelectorAll('#main-content [class]').forEach((e) =>
      e.classList.forEach((c) => classes.add(c)));
    out.push(`\nclass names inside #main-content (${classes.size}): ${trunc(Array.from(classes).join(' '), 3500)}`);

    const report = out.join('\n');
    console.log(report);
    try {
      await navigator.clipboard.writeText(report);
      toast('Diagnostics copied to clipboard. Paste them to Claude.');
    } catch (e) {
      toast('Diagnostics printed to the console (clipboard blocked).', 'err');
    }
  }

  /* ---------- hotkey ---------- */

  function onKey(e) {
    if (!settings.enabled) return;
    if (e.key !== settings.hotkey) return;
    if (e.altKey || e.metaKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
        (t.closest && t.closest('[contenteditable="true"],[role="textbox"]')))) return;

    if (e.ctrlKey) {                       // Ctrl + hotkey = copy a diagnostics report
      e.preventDefault(); e.stopPropagation();
      diagnostics();
      return;
    }
    if (!plan.steps.length) {
      toast(plan.errors.length
        ? 'Config error: ' + plan.errors[0]
        : 'No files configured. Open the extension popup, paste your list, and click Save.', 'err');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    advance();
  }
  window.addEventListener('keydown', onKey, true);

  /* ---------- settings + SPA navigation ---------- */

  chrome.storage.local.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    rebuild();
    console.log('[GS Nav] loaded; steps =', plan.steps.length, '; hotkey =', JSON.stringify(settings.hotkey));
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k in changes) settings[k] = changes[k].newValue;
    rebuild();
  });
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; resetState(); }
  }, 500);
})();
