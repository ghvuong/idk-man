// Bootstrap: wires the canvas, pen input, panel, files and Claude recognition together.

import {
  app, onChange, changed, commit, undo, redo, select, clearSelection, deleteSelection, selectedSingle,
  loadSaved, replaceDiagram,
} from './state.js';
import { initMath, onMathChange } from './math.js';
import * as C from './canvas.js';
import { initPen, cancelPending, flushPending, hasPending } from './pen.js';
import {
  toast, hideToast, setHint, renderHint, initLabelEditor, openLabelEditor, closeEditor, isEditing,
  positionEditor, renderInspector, initInspector, scheduleOutput, renderOutput, initOutput, openHelp,
} from './panel.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import { parseTikzCD } from './tikz.js';
import { exportSVG, CELL_W, CELL_H } from './render.js';
import { saveFile, svgString, svgToPng, inkToPng } from './io.js';
import { aiReady, recognizeLabel, recognizeDiagram, errorKind } from './ai.js';
import { EXAMPLES } from './examples.js';
import { emptyDiagram } from './model.js';

const $ = (id) => document.getElementById(id);

// ---------- rendering on change ----------

let inspectorQueued = false;
onChange((info) => {
  C.renderCanvas();
  positionEditor();
  $('btn-undo').disabled = !app.history.past.length;
  $('btn-redo').disabled = !app.history.future.length;
  if (info.diagram) scheduleOutput();
  if (info.selection || (info.diagram && !info.quiet)) {
    if (!inspectorQueued) {
      inspectorQueued = true;
      requestAnimationFrame(() => { inspectorQueued = false; renderInspector(); });
    }
  }
});

onMathChange(() => {
  C.renderCanvas();
  positionEditor();
  renderOutput();
});

// ---------- tools ----------

function setTool(tool) {
  if (tool === 'sketch' && !app.ai) return;
  if (hasPending()) flushPending();
  app.tool = tool;
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-checked', String(b.dataset.tool === tool));
  $('sketch-bar').hidden = tool !== 'sketch';
  if (tool !== 'sketch') { app.eraser = false; $('btn-eraser').setAttribute('aria-pressed', 'false'); }
  setHint(null);
  C.clearGhost();
  changed({ selection: true });
}

// ---------- handwriting → label ----------

const reading = new Set();
function showReading() {
  C.setReadingInk([...reading]);
}

async function onHandwriting(p) {
  let target;
  if (p.target.cell) {
    const { col, row } = p.target.cell;
    let id;
    const existing = app.diagram.nodeAt(col, row);
    if (existing && existing.label.trim()) return; // never overwrite a label from stray ink
    if (existing) id = existing.id;
    else commit((d) => { id = d.addNode(col, row, '').id; });
    target = { kind: 'node', id, isNew: !existing };
  } else if (p.target.node) {
    target = { kind: 'node', id: p.target.node };
  } else {
    target = { kind: 'edge', id: p.target.edge };
  }
  select(target.kind === 'node' ? { nodes: [target.id] } : { edges: [target.id] });
  if (!app.ai) {
    openLabelEditor(target, { isNew: !!target.isNew });
    return;
  }
  const strokes = p.strokes;
  reading.add(strokes);
  showReading();
  toast(t('toast.reading'));
  try {
    const img = await inkToPng(strokes, { maxSide: 640, pad: 18, width: 3 });
    const latex = img ? await recognizeLabel(img.blob) : '';
    const item = target.kind === 'node' ? app.diagram.node(target.id) : app.diagram.edge(target.id);
    if (!item) return;
    if (latex) {
      commit(() => { item.label = latex; });
      hideToast();
    } else {
      toast(t('toast.readFail'));
      openLabelEditor(target, { isNew: !!target.isNew });
    }
  } catch (e) {
    const kind = errorKind(e);
    if (kind === 'denied') disableAI();
    toast(t(kind === 'denied' ? 'toast.aiDenied' : kind === 'limited' ? 'toast.aiLimited' : 'toast.readFail'));
    openLabelEditor(target, { isNew: !!target.isNew });
  } finally {
    reading.delete(strokes);
    showReading();
  }
}

function disableAI() {
  app.ai = false;
  document.querySelector('.tool[data-tool="sketch"]').hidden = true;
  $('photo-btn').hidden = true;
  if (app.tool === 'sketch') setTool('pen');
}

// ---------- sketch / photo → diagram ----------

let recognizeCtl = null;

async function runRecognition(blob, origin, { removeInk = false } = {}) {
  if (recognizeCtl) recognizeCtl.abort();
  const ctl = new AbortController();
  recognizeCtl = ctl;
  $('btn-recognize').disabled = true;
  toast(t('toast.recognizing'), { sticky: true, action: { label: t('act.stop'), run: () => ctl.abort() } });
  try {
    const res = await recognizeDiagram(blob, { signal: ctl.signal });
    if (!res.nodes.length) throw { code: 'empty' };
    placeRecognized(res, origin, removeInk);
    setTool('pen');
    requestAnimationFrame(() => C.fitView());
    toast(t('toast.recognized'), { action: { label: t('act.undo'), run: undo } });
  } catch (e) {
    const kind = errorKind(e);
    if (kind === 'cancelled') { hideToast(); return; }
    if (kind === 'denied') disableAI();
    toast(t(kind === 'denied' ? 'toast.aiDenied' : kind === 'limited' ? 'toast.aiLimited' : 'toast.recognizeFail'));
  } finally {
    if (recognizeCtl === ctl) recognizeCtl = null;
    $('btn-recognize').disabled = false;
  }
}

function placeRecognized(res, origin, removeInk) {
  commit((d) => {
    if (removeInk) d.ink = [];
    const minC = Math.min(...res.nodes.map((n) => n.col));
    const minR = Math.min(...res.nodes.map((n) => n.row));
    let ox = origin.col - minC;
    const oy = origin.row - minR;
    while (res.nodes.some((n) => d.nodeAt(n.col + ox, n.row + oy))) ox++;
    const ids = new Map();
    for (const n of res.nodes) ids.set(n.key, d.addNode(n.col + ox, n.row + oy, n.label).id);
    for (const e of res.edges) {
      d.addEdge(ids.get(e.from), ids.get(e.to), {
        label: e.label, side: e.side, head: e.head, tail: e.tail, body: e.body, double: e.double,
        bend: e.from === e.to ? 0 : e.bend, loop: e.loop,
      });
    }
    for (const c of res.corners) {
      const a = d.node(ids.get(c.at)), b = d.node(ids.get(c.toward));
      const sx = Math.sign(b.col - a.col) || 1, sy = Math.sign(b.row - a.row) || 1;
      const target = d.nodeAt(a.col + sx, a.row + sy) || d.addNode(a.col + sx, a.row + sy, '');
      d.addEdge(a.id, target.id, { kind: 'corner' });
    }
  });
  clearSelection();
}

async function recognizeSketch() {
  const strokes = app.diagram.ink;
  if (!strokes.length) { toast(t('toast.noInk')); return; }
  const img = await inkToPng(strokes, { maxSide: 1200, pad: 28, width: 3.2 });
  const pts = strokes.flatMap((s) => s.points);
  const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
  const origin = C.cellOf({ x: x0 + CELL_W * 0.3, y: y0 + CELL_H * 0.3 });
  await runRecognition(img.blob, origin, { removeInk: true });
}

async function recognizePhoto(file) {
  const b = app.diagram.bounds();
  const origin = b ? { col: b.c1 + 2, row: b.r0 } : { col: 0, row: 0 };
  await runRecognition(file, origin);
}

// ---------- files ----------

async function save(name, data, mime) {
  const r = await saveFile(name, data, mime);
  if (r === 'saved') toast(t('toast.saved'));
  else if (r === 'unavailable') toast(t('toast.saveFailed'));
}

function fileStem() {
  const first = app.diagram.nodes.find((n) => n.label.trim());
  const stem = first ? first.label.replace(/\\[a-zA-Z]+/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  return `so-do${stem ? '-' + stem.slice(0, 24) : ''}`;
}

function confirmDialog(text) {
  return new Promise((resolve) => {
    const dlg = $('confirm-dialog');
    $('confirm-text').textContent = text;
    const done = (v) => { dlg.close(); resolve(v); };
    $('confirm-yes').onclick = () => done(true);
    $('confirm-no').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

// ---------- wiring ----------

function bindUI() {
  for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('btn-undo').addEventListener('click', () => { cancelPending(); undo(); });
  $('btn-redo').addEventListener('click', () => { cancelPending(); redo(); });
  $('btn-fit').addEventListener('click', () => C.fitView());
  $('btn-zoom-in').addEventListener('click', () => {
    const r = C.stageRect();
    C.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  });
  $('btn-zoom-out').addEventListener('click', () => {
    const r = C.stageRect();
    C.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
  });
  $('btn-clear').addEventListener('click', async () => {
    if (app.diagram.isEmpty()) return;
    if (!(await confirmDialog(t('act.confirmClear')))) return;
    cancelPending();
    replaceDiagram(emptyDiagram());
    toast(t('toast.cleared'), { action: { label: t('act.undo'), run: undo } });
  });
  let exampleIndex = 0;
  $('btn-example').addEventListener('click', () => {
    cancelPending();
    replaceDiagram(EXAMPLES[exampleIndex % EXAMPLES.length]);
    exampleIndex++;
    C.fitView();
    toast(t('toast.example'), { action: { label: t('act.undo'), run: undo } });
  });
  $('btn-help').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  $('btn-lang').addEventListener('click', () => {
    setLang(getLang() === 'vi' ? 'en' : 'vi');
    applyI18n();
    renderHint();
    renderInspector();
    renderOutput();
  });

  $('btn-recognize').addEventListener('click', recognizeSketch);
  $('btn-eraser').addEventListener('click', () => {
    app.eraser = !app.eraser;
    $('btn-eraser').setAttribute('aria-pressed', String(app.eraser));
  });
  $('btn-clear-ink').addEventListener('click', () => commit((d) => { d.ink = []; }));

  $('btn-svg').addEventListener('click', () => {
    if (!app.diagram.nodes.length) return;
    const { svg } = exportSVG(app.diagram, { color: '#111' });
    save(`${fileStem()}.svg`, svgString(svg), 'image/svg+xml');
  });
  $('btn-png').addEventListener('click', async () => {
    if (!app.diagram.nodes.length) return;
    const { svg, width, height } = exportSVG(app.diagram, { color: '#111' });
    try {
      const blob = await svgToPng(svg, width, height, 3, '#ffffff');
      save(`${fileStem()}.png`, blob, 'image/png');
    } catch {
      toast(t('toast.saveFailed'));
    }
  });
  $('btn-save-json').addEventListener('click', () => {
    save(`${fileStem()}.json`, JSON.stringify({ app: 'cd-sketchpad', version: 1, ...app.diagram.toJSON() }, null, 2), 'application/json');
  });
  $('file-json').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('shape');
      cancelPending();
      replaceDiagram(data);
      C.fitView();
      toast(t('toast.loaded'), { action: { label: t('act.undo'), run: undo } });
    } catch {
      toast(t('toast.badFile'));
    }
  });
  $('file-photo').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (file) recognizePhoto(file);
  });

  $('btn-import').addEventListener('click', () => {
    $('import-error').hidden = true;
    $('import-dialog').showModal();
    $('import-text').focus();
  });
  $('import-cancel').addEventListener('click', () => $('import-dialog').close());
  $('import-apply').addEventListener('click', () => {
    const src = $('import-text').value;
    let parsed = null;
    try { parsed = parseTikzCD(src); } catch { parsed = null; }
    if (!parsed || !parsed.diagram.nodes.length) {
      $('import-error').textContent = t('import.fail');
      $('import-error').hidden = false;
      return;
    }
    $('import-dialog').close();
    cancelPending();
    replaceDiagram(parsed.diagram.toJSON());
    C.fitView();
    toast(t('import.ok'), { action: { label: t('act.undo'), run: undo } });
  });

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => positionEditor());
}

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function onKey(e) {
  if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  if (mod && key.toLowerCase() === 'z') { e.preventDefault(); cancelPending(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (key === 'Delete' || key === 'Backspace') {
    if (deleteSelection()) { e.preventDefault(); toast(t('toast.deleted'), { action: { label: t('act.undo'), run: undo } }); }
    return;
  }
  if (key === 'Escape') { cancelPending(); clearSelection(); return; }
  if (key === 'Enter') {
    const s = selectedSingle();
    if (s) { e.preventDefault(); openLabelEditor(s); }
    return;
  }
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[key] && app.selection.nodes.size) {
    e.preventDefault();
    const [dc, dr] = dirs[key];
    commit((d) => d.moveNodes([...app.selection.nodes], dc, dr));
    return;
  }
  if (!e.altKey && key.length === 1 && key !== ' ') {
    const s = selectedSingle();
    if (s) { e.preventDefault(); openLabelEditor(s, { initial: key }); }
  }
}

// ---------- start ----------

function start() {
  applyI18n();
  document.documentElement.lang = getLang();
  const svg = C.initCanvas();
  initLabelEditor();
  initInspector();
  initOutput();
  initPen(svg, {
    openLabelEditor,
    commitEditor: () => closeEditor(true),
    isEditing,
    toast: (key) => toast(t(`toast.${key}`), key === 'deleted' ? { action: { label: t('act.undo'), run: undo } } : {}),
    hint: setHint,
    onHandwriting,
  });
  bindUI();
  initMath();
  if (!loadSaved()) app.diagram.load(EXAMPLES[0]);
  C.renderCanvas();
  C.fitView();
  renderHint();
  renderInspector();
  renderOutput();
  $('btn-undo').disabled = true;
  $('btn-redo').disabled = true;
  aiReady().then((ok) => {
    app.ai = ok;
    document.querySelector('.tool[data-tool="sketch"]').hidden = !ok;
    $('photo-btn').hidden = !ok;
  });
}

start();

// Handle for automated tests and the curious.
window.cdSketchpad = { app, cellToClient: (col, row) => {
  const r = C.stageRect();
  return { x: r.left + app.view.x + col * CELL_W * app.view.k, y: r.top + app.view.y + row * CELL_H * app.view.k };
} };
