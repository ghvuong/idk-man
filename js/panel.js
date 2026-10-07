// Side panel (inspector + generated code), inline label editor, toasts, hints, dialogs.

import {
  app, commit, mutateQuietly, recordFrom, select, deleteSelection, changed, selectedSingle, undo,
} from './state.js';
import { t } from './i18n.js';
import * as C from './canvas.js';
import { toTikzCD, needsSquiggly } from './tikz.js';
import { toCD, toXymatrix, toQuiverURL } from './formats.js';
import { exportSVG } from './render.js';
import { copyText } from './io.js';

const $ = (id) => document.getElementById(id);

// ---------- toasts & hints ----------

let toastTimer = 0;
export function toast(message, { action = null, sticky = false } = {}) {
  const el = $('toast');
  el.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); hideToast(); });
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideToast, action ? 4200 : 2600);
}

export function hideToast() {
  $('toast').classList.remove('show');
}

let hintKey = null;
export function setHint(key) {
  hintKey = key;
  renderHint();
}

export function renderHint() {
  const el = $('hint');
  const key = hintKey ? `hint.${hintKey}` : `hint.${app.tool}`;
  el.textContent = t(key);
}

// ---------- inline label editor ----------

const SYMBOLS = [
  ['x₁', '_{}', 1], ['x²', '^{}', 1], ['×', '\\times '], ['⊗', '\\otimes '], ['⊕', '\\oplus '], ['∘', '\\circ '],
  ['→', '\\to '], ['≅', '\\cong '], ['𝒞', '\\mathcal{}', 1], ['𝔸', '\\mathbb{}', 1], ['α', '\\alpha '],
  ['π', '\\pi '], ['⋯', '\\cdots '], ['Spec', '\\operatorname{Spec} '],
];

let editing = null; // {target, before, isNew}

export function isEditing() {
  return !!editing;
}

function editorItem() {
  if (!editing) return null;
  return editing.target.kind === 'node' ? app.diagram.node(editing.target.id) : app.diagram.edge(editing.target.id);
}

export function initLabelEditor() {
  const input = $('label-input');
  const box = $('symbols');
  for (const [glyph, text, back] of SYMBOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = text.trim();
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
    b.addEventListener('click', () => {
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + text + input.value.slice(e);
      const pos = s + text.length - (back || 0);
      input.setSelectionRange(pos, pos);
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
    box.appendChild(b);
  }
  input.addEventListener('input', () => {
    const item = editorItem();
    if (!item) return;
    mutateQuietly(() => { item.label = input.value; });
    positionEditor();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeEditor(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
    else if (e.key === 'Tab') { e.preventDefault(); closeEditor(true); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => setTimeout(() => { if (editing && document.activeElement !== input) closeEditor(true); }, 0));
}

export function openLabelEditor(target, { isNew = false, initial = null } = {}) {
  if (editing) closeEditor(true);
  const item = target.kind === 'node' ? app.diagram.node(target.id) : app.diagram.edge(target.id);
  if (!item) return;
  editing = { target, before: app.diagram.snapshot(), isNew };
  const input = $('label-input');
  input.placeholder = t(target.kind === 'node' ? 'insp.label.ph' : 'insp.edgeLabel.ph');
  $('label-editor').hidden = false;
  if (initial !== null) {
    input.value = initial;
    mutateQuietly(() => { item.label = initial; });
  } else {
    input.value = item.label;
  }
  positionEditor();
  input.focus({ preventScroll: true });
  if (initial === null) input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
}

export function positionEditor() {
  if (!editing) return;
  const ed = $('label-editor');
  let anchor;
  if (editing.target.kind === 'node') {
    const b = C.geo.layout && C.geo.layout.boxes.get(editing.target.id);
    if (!b) return;
    anchor = { x: b.x, y: b.y + Math.max(b.hh, 12) + 10 };
  } else {
    const g = C.geo.geoms.get(editing.target.id);
    if (!g) return;
    const l = g.label;
    anchor = l ? { x: l.x, y: l.y + l.h / 2 + 10 } : { x: g.mid.x, y: g.mid.y + 14 };
  }
  const s = C.toStage(anchor);
  const stage = C.stageElement().getBoundingClientRect();
  const w = ed.offsetWidth || 240;
  const x = Math.min(stage.width - w / 2 - 8, Math.max(w / 2 + 8, s.x));
  const y = Math.min(stage.height - (ed.offsetHeight || 90) - 8, Math.max(8, s.y));
  ed.style.left = `${x}px`;
  ed.style.top = `${y}px`;
}

export function closeEditor(keep = true) {
  if (!editing) return;
  const ed = editing;
  editing = null;
  $('label-editor').hidden = true;
  const item = ed.target.kind === 'node' ? app.diagram.node(ed.target.id) : app.diagram.edge(ed.target.id);
  if (!keep) {
    app.diagram.restore(ed.before);
    changed({ diagram: true });
  }
  const fresh = item && ed.target.kind === 'node' && ed.isNew;
  if (fresh) {
    const node = app.diagram.node(ed.target.id);
    if (node && !node.label.trim() && !app.diagram.edgesOf(node.id).length) {
      // An object created by a tap and left empty is removed, as if the tap never happened.
      app.diagram.removeNode(node.id);
      if (app.history.past.length) app.diagram.restore(app.history.past.pop());
      changed({ diagram: true });
      return;
    }
  }
  if (keep) recordFrom(ed.before);
  C.svgFocus();
}

// ---------- inspector ----------

const HEADS = [['to', '→'], ['epi', '↠'], ['harpoon', '⇀'], ["harpoon'", '⇁'], ['none', '—']];
const TAILS = [['none', '–'], ['hook', '↪'], ["hook'", '<span class="flip">↪</span>'], ['mono', '↣'], ['mapsto', '↦']];
const BODIES = [['solid', '—'], ['dashed', '⇢'], ['dotted', '⋯'], ['squiggly', '⇝']];
const LOOPS = [[90, '↑'], [45, '↗'], [0, '→'], [315, '↘'], [270, '↓'], [225, '↙'], [180, '←'], [135, '↖']];
const TITLES = {
  head: { to: '\\to', epi: 'two heads', harpoon: 'harpoon', "harpoon'": "harpoon'", none: 'no head' },
  tail: { none: '—', hook: 'hook', "hook'": "hook'", mono: 'tail', mapsto: 'maps to' },
  body: { solid: '—', dashed: 'dashed', dotted: 'dotted', squiggly: 'squiggly' },
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function seg(name, options, current, cls = '') {
  return `<div class="seg" data-seg="${name}">${options.map(([v, glyph, title]) =>
    `<button type="button" class="${cls}" data-v="${esc(v)}" aria-pressed="${String(v) === String(current)}" title="${esc(title || TITLES[name]?.[v] || '')}">${glyph}</button>`).join('')}</div>`;
}

export function renderInspector() {
  const el = $('inspector');
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') {
    // Don't rebuild under the user's cursor; just refresh the toggles.
    syncInspectorToggles();
    return;
  }
  const d = app.diagram;
  const single = selectedSingle();
  const count = app.selection.nodes.size + app.selection.edges.size;
  if (!count) {
    el.innerHTML = `<h2>${esc(t('insp.empty.title'))}</h2><p class="lead">${esc(t('insp.empty.body'))}</p>
      <div class="btn-row"><button class="btn" data-act="help">${esc(t('act.help'))}</button></div>`;
  } else if (!single) {
    el.innerHTML = `<h2>${esc(t('insp.multi', { n: count }))}</h2>
      <div class="btn-row"><button class="btn danger" data-act="delete">${esc(t('act.delete'))}</button></div>`;
  } else if (single.kind === 'node') {
    const n = d.node(single.id);
    el.innerHTML = `<h2>${esc(t('insp.node'))} <span class="cellref">· ${esc(t('insp.cell', { r: n.row, c: n.col }))}</span></h2>
      <div class="field"><label for="insp-label">${esc(t('insp.label'))}</label>
        <input type="text" id="insp-label" value="${esc(n.label)}" placeholder="${esc(t('insp.label.ph'))}" autocomplete="off" spellcheck="false" autocapitalize="off"></div>
      <div class="btn-row"><button class="btn" data-act="corner">${esc(t('insp.corner'))}</button>
        <button class="btn danger" data-act="delete">${esc(t('act.delete'))}</button></div>`;
  } else {
    const e = d.edge(single.id);
    const a = d.node(e.from), b = d.node(e.to);
    const name = (n) => (n.label.trim() ? n.label.trim() : '∙');
    const isLoop = e.from === e.to;
    const shiftOpts = [['auto', esc(t('insp.shift.auto')), ''], ['-2', '−2'], ['-1', '−1'], ['0', '0'], ['1', '+1'], ['2', '+2']];
    el.innerHTML = `<h2>${esc(t('insp.edge'))} <span class="cellref">· ${esc(name(a))} → ${esc(name(b))}</span></h2>
      <div class="field"><label for="insp-label">${esc(t('insp.label'))}</label>
        <input type="text" id="insp-label" value="${esc(e.label)}" placeholder="${esc(t('insp.edgeLabel.ph'))}" autocomplete="off" spellcheck="false" autocapitalize="off"></div>
      ${e.kind === 'arrow' ? `
      <div class="field"><span class="field-name">${esc(t('insp.side'))}</span>
        ${seg('side', [['left', esc(t('side.left'))], ['right', esc(t('side.right'))], ['over', esc(t('side.over'))]], e.side, 'text')}</div>
      <div class="field"><span class="field-name">${esc(t('insp.head'))}</span>${seg('head', HEADS, e.head)}</div>
      <div class="field"><span class="field-name">${esc(t('insp.tail'))}</span>${seg('tail', TAILS, e.tail)}</div>
      <div class="field"><span class="field-name">${esc(t('insp.body'))}</span>
        <div class="row">${seg('body', BODIES, e.body)}${seg('double', [['true', '⇒', t('insp.double')]], String(e.double))}</div></div>
      ${isLoop ? `<div class="field"><span class="field-name">${esc(t('insp.loop'))}</span>${seg('loop', LOOPS, e.loop)}</div>` : `
      <div class="field"><label for="insp-bend">${esc(t('insp.bend'))}</label>
        <div class="row"><input type="range" id="insp-bend" min="-90" max="90" step="5" value="${e.bend}"><output id="insp-bend-out">${e.bend}°</output></div></div>
      <div class="field"><span class="field-name">${esc(t('insp.shift'))}</span>${seg('shift', shiftOpts, e.shift === null ? 'auto' : e.shift, 'text')}</div>`}` : ''}
      ${!isLoop ? `<div class="field"><span class="field-name">${esc(t('insp.kind'))}</span>
        ${seg('kind', [['arrow', esc(t('kind.arrow'))], ['phantom', esc(t('kind.phantom'))], ['corner', esc(t('kind.corner'))]], e.kind, 'text')}</div>` : ''}
      <div class="btn-row">${!isLoop ? `<button class="btn" data-act="reverse">${esc(t('act.reverse'))}</button>` : ''}
        <button class="btn danger" data-act="delete">${esc(t('act.delete'))}</button></div>`;
  }
}

function syncInspectorToggles() {
  const single = selectedSingle();
  if (!single || single.kind !== 'edge') return;
  const e = app.diagram.edge(single.id);
  if (!e) return;
  for (const s of $('inspector').querySelectorAll('[data-seg]')) {
    const name = s.dataset.seg;
    const cur = name === 'shift' ? (e.shift === null ? 'auto' : e.shift) : e[name];
    for (const b of s.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(cur)));
  }
}

export function initInspector() {
  const el = $('inspector');
  let labelBefore = null;
  el.addEventListener('focusin', (ev) => {
    if (ev.target.id === 'insp-label') labelBefore = app.diagram.snapshot();
  });
  el.addEventListener('input', (ev) => {
    const single = selectedSingle();
    if (!single) return;
    if (ev.target.id === 'insp-label') {
      const item = single.kind === 'node' ? app.diagram.node(single.id) : app.diagram.edge(single.id);
      mutateQuietly(() => { item.label = ev.target.value; });
    } else if (ev.target.id === 'insp-bend') {
      const e = app.diagram.edge(single.id);
      if (labelBefore === null) labelBefore = app.diagram.snapshot();
      mutateQuietly(() => { e.bend = Number(ev.target.value); if (e.bend) e.shift = null; });
      $('insp-bend-out').textContent = `${e.bend}°`;
    }
  });
  el.addEventListener('change', (ev) => {
    if ((ev.target.id === 'insp-label' || ev.target.id === 'insp-bend') && labelBefore !== null) {
      recordFrom(labelBefore);
      labelBefore = ev.target.id === 'insp-label' ? app.diagram.snapshot() : null;
    }
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.target.id === 'insp-label' && ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
    ev.stopPropagation();
  });
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const single = selectedSingle();
    const act = btn.dataset.act;
    if (act === 'delete') { deleteSelection(); toast(t('toast.deleted'), { action: { label: t('act.undo'), run: undo } }); return; }
    if (act === 'help') { openHelp(); return; }
    if (act === 'corner' && single) { addCornerFor(single.id); return; }
    if (act === 'reverse' && single) {
      commit((d) => {
        const e = d.edge(single.id);
        [e.from, e.to] = [e.to, e.from];
        e.bend = -e.bend;
        if (e.side !== 'over') e.side = e.side === 'left' ? 'right' : 'left';
      });
      renderInspector();
      return;
    }
    const segEl = btn.closest('[data-seg]');
    if (!segEl || !single || single.kind !== 'edge') return;
    const name = segEl.dataset.seg;
    const v = btn.dataset.v;
    commit((d) => {
      const e = d.edge(single.id);
      if (name === 'double') e.double = !e.double;
      else if (name === 'shift') e.shift = v === 'auto' ? null : Number(v);
      else if (name === 'loop') e.loop = Number(v);
      else if (name === 'kind') {
        e.kind = v;
        if (v === 'corner') {
          // A corner mark points diagonally; make sure it does.
          const a = d.node(e.from), b = d.node(e.to);
          const dc = Math.sign(b.col - a.col) || 1, dr = Math.sign(b.row - a.row) || 1;
          const target = d.nodeAt(a.col + dc, a.row + dr) || d.addNode(a.col + dc, a.row + dr, '');
          e.to = target.id;
        }
      } else e[name] = v;
    });
    renderInspector();
  });
}

function addCornerFor(nodeId) {
  const d = app.diagram;
  const n = d.node(nodeId);
  // Point into the quadrant that has the most arrows leaving this object.
  let sx = 1, sy = 1;
  const out = d.edges.filter((e) => e.from === nodeId && e.to !== nodeId).map((e) => d.node(e.to));
  if (out.length) {
    const mx = out.reduce((s, m) => s + Math.sign(m.col - n.col), 0);
    const my = out.reduce((s, m) => s + Math.sign(m.row - n.row), 0);
    sx = mx < 0 ? -1 : 1;
    sy = my < 0 ? -1 : 1;
  }
  let id;
  commit((dd) => {
    const target = dd.nodeAt(n.col + sx, n.row + sy) || dd.addNode(n.col + sx, n.row + sy, '');
    const existing = dd.edges.find((e) => e.kind === 'corner' && e.from === nodeId);
    if (existing) { existing.to = target.id; id = existing.id; } else id = dd.addEdge(nodeId, target.id, { kind: 'corner' }).id;
  });
  select({ edges: [id] });
}

// ---------- output ----------

let outputQueued = false;
export function scheduleOutput() {
  if (outputQueued) return;
  outputQueued = true;
  requestAnimationFrame(() => { outputQueued = false; renderOutput(); });
}

export function currentCode() {
  const d = app.diagram;
  if (app.format === 'cd') {
    const r = toCD(d);
    return r.ok ? r.code : '';
  }
  if (app.format === 'xy') return toXymatrix(d);
  return toTikzCD(d);
}

export function renderOutput() {
  const d = app.diagram;
  const code = $('code-text');
  const note = $('code-note');
  for (const tab of document.querySelectorAll('.tabs [role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.format === app.format));
  if (app.format === 'cd') {
    const r = toCD(d);
    code.textContent = r.ok ? r.code : '';
    $('code').hidden = !r.ok;
    note.textContent = r.ok ? t('out.cd.note') + (r.dropped ? ' ' + t('cd.dropped') : '') : t(r.reason);
  } else if (app.format === 'xy') {
    $('code').hidden = false;
    code.textContent = toXymatrix(d);
    note.textContent = t('out.xy.note') + (d.edges.some((e) => e.from === e.to) ? ' ' + t('out.xy.loops') : '');
  } else {
    $('code').hidden = false;
    code.textContent = toTikzCD(d);
    note.textContent = t('out.preamble') + (needsSquiggly(d) ? ' ' + t('out.preamble.squiggly') : '');
  }
  $('btn-copy').disabled = !code.textContent;
  $('btn-quiver').href = toQuiverURL(d);
  const preview = $('preview');
  preview.replaceChildren();
  if (d.nodes.length) {
    const { svg } = exportSVG(d, { color: 'currentColor' });
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Preview');
    preview.appendChild(svg);
  }
}

export function initOutput() {
  for (const tab of document.querySelectorAll('.tabs [role="tab"]')) {
    tab.addEventListener('click', () => {
      app.format = tab.dataset.format;
      try { localStorage.setItem('cd-sketchpad:format', app.format); } catch { /* ignore */ }
      renderOutput();
    });
  }
  try {
    const f = localStorage.getItem('cd-sketchpad:format');
    if (['tikz', 'cd', 'xy'].includes(f)) app.format = f;
  } catch { /* ignore */ }
  $('btn-copy').addEventListener('click', () => {
    const btn = $('btn-copy');
    copyText($('code-text').textContent, $('code-text')).then((ok) => {
      btn.textContent = t(ok ? 'act.copied' : 'act.copy');
      setTimeout(() => { btn.textContent = t('act.copy'); }, 1600);
    });
  });
}

// ---------- help ----------

const STROKE = (d) => `<path class="pen-stroke" d="${d}"/>`;
const HEAD = (x, y) => `<path class="pen-stroke" d="M${x - 6} ${y - 5}l6 5-6 5"/>`;
const TXT = (x, y, s, size = 13) => `<text x="${x}" y="${y}" font-family="'Latin Modern Math','STIX Two Math','Cambria Math',serif" font-style="italic" font-size="${size}" fill="currentColor" text-anchor="middle">${s}</text>`;
const HELP = [
  [`${TXT(44, 27, 'X')}<circle cx="44" cy="22" r="13" fill="none" stroke="var(--pen)" stroke-dasharray="3 3"/>`,
    { vi: '<b>Chạm</b> vào ô trống để thêm đối tượng rồi gõ nhãn LaTeX (vd. <code>X_1</code>).', en: '<b>Tap</b> an empty cell to add an object, then type its LaTeX label (e.g. <code>X_1</code>).' }],
  [`${TXT(12, 27, 'A')}${TXT(76, 27, 'B')}${STROKE('M20 23c12-4 26 3 46-1')}${HEAD(66, 22)}`,
    { vi: '<b>Kéo một nét</b> từ đối tượng này sang đối tượng kia: có mũi tên. Nét cong cho mũi tên cong.', en: '<b>Draw a stroke</b> from one object to another to get an arrow. A curved stroke gives a bent arrow.' }],
  [`${TXT(12, 27, 'A')}${STROKE('M20 23h42')}${HEAD(63, 23)}<circle cx="74" cy="23" r="7" fill="none" stroke="var(--pen)" stroke-dasharray="3 3"/>`,
    { vi: 'Kéo ra <b>chỗ trống</b>: tự tạo đối tượng mới ở ô đó.', en: 'Draw into <b>empty space</b> to create a new object there.' }],
  [`${TXT(12, 27, 'A')}${TXT(76, 27, 'B')}${STROKE('M20 23h8M34 23h8M48 23h8M62 23h4')}${HEAD(66, 23)}`,
    { vi: 'Vẽ <b>nhiều gạch ngắn</b> nối tiếp: mũi tên nét đứt.', en: 'Draw <b>several short dashes</b> in a row for a dashed arrow.' }],
  [`${STROKE('M14 15c-6 0-6 8 0 8h52')}${STROKE('M60 17l7 6-7 6')}`,
    { vi: 'Bắt đầu nét bằng <b>một móc nhỏ</b>: ↪. Thêm một <b>gạch ngang ở đuôi</b>: ↦. Thêm <b>dấu &gt; ở đuôi</b>: ↣. Thêm <b>dấu &gt; thứ hai ở đầu</b>: ↠.', en: 'Start the stroke with <b>a small hook</b> for ↪. Add a <b>bar at the tail</b> for ↦, a <b>chevron at the tail</b> for ↣, a <b>second chevron at the head</b> for ↠.' }],
  [`${TXT(30, 33, 'A')}${STROKE('M34 22c4-16 30-16 22 2-3 6-9 6-14 4')}`,
    { vi: 'Đi ra rồi <b>quay về chính đối tượng</b>: vòng lặp (tự đồng cấu).', en: 'Leave an object and <b>come back to it</b> for a loop.' }],
  [`${TXT(14, 18, 'P')}${TXT(74, 18, 'Y')}${TXT(14, 42, 'X')}${TXT(74, 42, 'Z')}${STROKE('M30 18v8h-8')}`,
    { vi: 'Vẽ dấu <b>⌟</b> trong hình vuông, sát một đỉnh: dấu pullback.', en: 'Draw a <b>⌟</b> inside a square next to a corner for the pullback mark.' }],
  [`${TXT(30, 28, 'Y', 16)}${STROKE('M44 30l6-16 5 16 5-16 5 16 5-14')}`,
    { vi: '<b>Gạch zíc-zắc</b> lên đối tượng hay mũi tên để xóa.', en: '<b>Scribble</b> over an object or arrow to delete it.' }],
  [`<ellipse cx="44" cy="22" rx="34" ry="16" fill="var(--pen-soft)" stroke="var(--pen)" stroke-dasharray="4 3"/>${TXT(32, 27, 'A')}${TXT(56, 27, 'B')}`,
    { vi: '<b>Khoanh vùng</b> để chọn nhiều đối tượng. <b>Giữ lâu</b> trên đối tượng rồi kéo để di chuyển.', en: '<b>Circle</b> objects to select them. <b>Press and hold</b> an object, then drag to move it.' }],
  [`${STROKE('M30 30c2-10 6-16 8-16s2 16 4 16 4-14 8-14')}${TXT(70, 27, 'X₁')}`,
    { vi: '<b>Viết tay</b> nhãn vào ô trống hoặc cạnh mũi tên: Claude đọc chữ (khi mở trên claude.ai). Ở nơi khác, ô nhập nhãn sẽ mở ra.', en: '<b>Handwrite</b> a label in an empty cell or next to an arrow: Claude reads it (when opened on claude.ai). Elsewhere the label box opens instead.' }],
];

export function openHelp() {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'vi';
  const rows = HELP.map(([svg, text]) => `<dt><svg viewBox="0 0 88 44" aria-hidden="true">${svg}</svg></dt><dd>${text[lang]}</dd>`).join('');
  const keys = lang === 'vi'
    ? '<kbd>Enter</kbd> sửa nhãn · gõ phím bất kỳ khi đang chọn để đặt nhãn · <kbd>Delete</kbd> xóa · <kbd>Ctrl</kbd>+<kbd>Z</kbd> hoàn tác · phím mũi tên di chuyển · giữ <kbd>Space</kbd> rồi kéo để cuộn · <kbd>Ctrl</kbd>+cuộn chuột hoặc hai ngón để thu phóng.'
    : '<kbd>Enter</kbd> edits the label · start typing with something selected to label it · <kbd>Delete</kbd> deletes · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes · arrow keys move · hold <kbd>Space</kbd> and drag to pan · <kbd>Ctrl</kbd>+wheel or two fingers to zoom.';
  $('help-body').innerHTML = `<h2 id="help-title">${esc(t('help.title'))}</h2><dl class="help-list">${rows}</dl><p class="help-keys">${keys}</p>`;
  $('help-dialog').showModal();
}
