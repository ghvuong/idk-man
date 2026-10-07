// The drawing surface: view transform, scene rendering, overlays and hit testing.

import { app } from './state.js';
import {
  CELL_W, CELL_H, EDITOR_STYLE, editorLayout, edgeGeometry, drawDiagram, sceneBounds,
} from './render.js';
import * as G from './geom.js';
import { directionLetters } from './tikz.js';

const NS = 'http://www.w3.org/2000/svg';
let svg, viewport, grid, under, scene, overlay, stage;
let liveInk = null, ghost = null, pendingLayer = null, readingLayer = null, sketchLayer = null, lassoPath = null;

export const geo = { layout: null, geoms: new Map() };

export function initCanvas() {
  svg = document.getElementById('canvas');
  viewport = document.getElementById('viewport');
  grid = document.getElementById('grid');
  under = document.getElementById('under');
  scene = document.getElementById('scene');
  overlay = document.getElementById('overlay');
  stage = document.getElementById('stage');
  sketchLayer = mk('g', { class: 'sketch-ink' }, under);
  pendingLayer = mk('g', { class: 'pending-ink' }, overlay);
  readingLayer = mk('g', { class: 'reading-ink' }, overlay);
  ghost = mk('g', { class: 'ghost' }, overlay);
  liveInk = mk('path', { class: 'ink-live' }, overlay);
  lassoPath = mk('path', { class: 'lasso' }, overlay);
  new ResizeObserver(() => applyView()).observe(stage);
  return svg;
}

function mk(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

// ---------- view ----------

export function stageRect() {
  return svg.getBoundingClientRect();
}

export function toWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  const v = app.view;
  return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
}

// World point → position relative to the stage's top-left corner (CSS px).
export function toStage(p) {
  const v = app.view;
  return { x: p.x * v.k + v.x, y: p.y * v.k + v.y };
}

export function applyView() {
  if (!svg) return;
  const v = app.view;
  viewport.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
  const r = svg.getBoundingClientRect();
  const x0 = -v.x / v.k, y0 = -v.y / v.k;
  grid.setAttribute('x', x0 - CELL_W);
  grid.setAttribute('y', y0 - CELL_H);
  grid.setAttribute('width', r.width / v.k + 2 * CELL_W);
  grid.setAttribute('height', r.height / v.k + 2 * CELL_H);
  const z = document.getElementById('zoom-level');
  if (z) z.textContent = `${Math.round(v.k * 100)}%`;
}

export function setView(x, y, k) {
  app.view = { x, y, k: Math.min(3, Math.max(0.3, k)) };
  applyView();
}

export function zoomAt(clientX, clientY, factor) {
  const r = svg.getBoundingClientRect();
  const v = app.view;
  const k = Math.min(3, Math.max(0.3, v.k * factor));
  const sx = clientX - r.left, sy = clientY - r.top;
  const wx = (sx - v.x) / v.k, wy = (sy - v.y) / v.k;
  setView(sx - wx * k, sy - wy * k, k);
}

export function panBy(dx, dy) {
  const v = app.view;
  setView(v.x + dx, v.y + dy, v.k);
}

export function fitView() {
  const r = svg.getBoundingClientRect();
  const d = app.diagram;
  let bb = null;
  if (d.nodes.length && geo.layout) bb = sceneBounds(d, geo.layout, geo.geoms);
  const inkPts = d.ink.flatMap((s) => s.points);
  if (inkPts.length) {
    const ib = G.bboxOf(inkPts);
    bb = bb ? G.bboxOf([{ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y1 }, { x: ib.x0, y: ib.y0 }, { x: ib.x1, y: ib.y1 }]) : ib;
  }
  if (!bb) {
    setView(r.width / 2 - CELL_W, r.height / 2 - CELL_H, 1);
    return;
  }
  const pad = 72;
  const k = Math.min(1.6, Math.max(0.4, Math.min((r.width - 2 * pad) / Math.max(bb.w, 1), (r.height - 2 * pad) / Math.max(bb.h, 1))));
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  setView(r.width / 2 - cx * k, r.height / 2 - cy * k, k);
}

// ---------- rendering ----------

export function renderCanvas() {
  const d = app.diagram;
  geo.layout = editorLayout(d, EDITOR_STYLE);
  geo.geoms = edgeGeometry(d, geo.layout, EDITOR_STYLE);
  scene.replaceChildren();
  drawDiagram(scene, d, geo.layout, geo.geoms, EDITOR_STYLE, { selection: app.selection, hover: app.hover });
  renderSketchInk();
  svg.classList.toggle('tool-select', app.tool === 'select');
}

export function renderSketchInk() {
  sketchLayer.replaceChildren();
  for (const s of app.diagram.ink) {
    mk('path', { d: smoothPath(s.points), class: 'ink-sketch', 'data-id': s.id }, sketchLayer);
  }
}

// Quadratic smoothing through midpoints for pleasant-looking ink.
export function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return G.polyPath(pts.length === 1 ? [pts[0], { x: pts[0].x + 0.1, y: pts[0].y }] : pts);
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

export function setLiveInk(points, cls = 'ink-live') {
  liveInk.setAttribute('class', cls);
  liveInk.setAttribute('d', points && points.length ? smoothPath(points) : '');
}

export function setLasso(points) {
  lassoPath.setAttribute('d', points && points.length > 2 ? G.polyPath(points, true) : '');
}

// Strokes waiting to be interpreted (dash chains, handwriting).
export function setPendingInk(strokes, reading = false) {
  pendingLayer.replaceChildren();
  for (const s of strokes || []) {
    mk('path', { d: smoothPath(s), class: reading ? 'ink-pending ink-reading' : 'ink-pending' }, pendingLayer);
  }
}

// Handwriting that Claude is currently reading.
export function setReadingInk(groups) {
  readingLayer.replaceChildren();
  for (const strokes of groups) {
    for (const s of strokes) mk('path', { d: smoothPath(s), class: 'ink-pending ink-reading' }, readingLayer);
  }
}

export function clearGhost() {
  ghost.replaceChildren();
}

// Preview of the arrow being drawn: straight line from the source to the target cell,
// a dashed circle where a new object will appear, and the tikz-cd direction tag.
export function showGhost(fromNodeId, target, { dashed = false } = {}) {
  ghost.replaceChildren();
  const fromBox = geo.layout.boxes.get(fromNodeId);
  const from = app.diagram.node(fromNodeId);
  if (!fromBox || !from || !target) return;
  const tc = { x: target.col * CELL_W, y: target.row * CELL_H };
  if (target.col === from.col && target.row === from.row) return;
  const tBox = target.nodeId ? geo.layout.boxes.get(target.nodeId) : { x: tc.x, y: tc.y, hw: 10, hh: 10 };
  const curve = G.lineAsBezier({ x: fromBox.x, y: fromBox.y }, { x: tBox.x, y: tBox.y });
  const [t0, t1] = G.clipBezierToBoxes(curve, fromBox, tBox);
  const vis = G.subBezier(curve, t0, t1);
  mk('path', {
    d: G.bezierPath(vis), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
    'stroke-dasharray': dashed ? '7 4' : '2 5', 'stroke-linecap': 'round',
  }, ghost);
  const dir = G.bezierTangent(vis, 1);
  const tip = vis[3];
  const a = G.deg(G.angleOf(dir));
  mk('path', {
    d: 'M-8 -6C-4.5 -2.3 -1.5 -0.5 0 0C-1.5 0.5 -4.5 2.3 -8 6', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linecap': 'round', transform: `translate(${tip.x} ${tip.y}) rotate(${a})`,
  }, ghost);
  if (!target.nodeId) mk('circle', { cx: tc.x, cy: tc.y, r: 12, class: 'ghost-node' }, ghost);
  // Direction letters as tikz-cd would write them.
  const letters = directionLetters(target.col - from.col, target.row - from.row);
  const mid = G.bezierPoint(vis, 0.5);
  const n = G.leftNormal(dir);
  const pos = G.add(mid, G.mul(n, 16));
  const g = mk('g', { transform: `translate(${pos.x} ${pos.y})` }, ghost);
  const w = 14 + letters.length * 7.5;
  mk('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 6, class: 'ghost-tag-bg' }, g);
  const t = mk('text', { class: 'ghost-tag', 'text-anchor': 'middle', y: 4 }, g);
  t.textContent = `[${letters}]`;
}

export function showCellHint(cell) {
  ghost.replaceChildren();
  if (!cell) return;
  mk('rect', {
    x: cell.col * CELL_W - CELL_W * 0.42, y: cell.row * CELL_H - CELL_H * 0.4,
    width: CELL_W * 0.84, height: CELL_H * 0.8, rx: 14, class: 'cell-hint',
  }, ghost);
}

// ---------- hit testing ----------

export function cellOf(p) {
  return { col: Math.round(p.x / CELL_W), row: Math.round(p.y / CELL_H) };
}

export function nodeAtCell(cell) {
  return app.diagram.nodeAt(cell.col, cell.row);
}

// The object whose cell contains p (cells are generous targets for fingers and pens).
export function nodeAtPoint(p) {
  return nodeAtCell(cellOf(p));
}

// Is p on the object's drawn label (with a little slack)?
export function onNodeBox(p, node, slack = 6) {
  const b = geo.layout && geo.layout.boxes.get(node.id);
  if (!b) return false;
  return Math.abs(p.x - b.x) <= b.hw + slack && Math.abs(p.y - b.y) <= b.hh + slack;
}

export function edgeAtPoint(p, tol) {
  let best = null, bestD = tol;
  for (const [id, g] of geo.geoms) {
    let dd = G.polylineDist(p, g.poly);
    if (g.label) {
      const l = g.label;
      if (Math.abs(p.x - l.x) <= l.w / 2 + 4 && Math.abs(p.y - l.y) <= l.h / 2 + 4) dd = 0;
    }
    if (dd < bestD) { bestD = dd; best = id; }
  }
  return best;
}

export function svgFocus() {
  if (svg) svg.focus({ preventScroll: true });
}

export function stageElement() {
  return stage;
}
