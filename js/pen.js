// Pointer input: pen strokes become objects and arrows; select/move/bend; pan and zoom.

import {
  app, commit, select, clearSelection, changed, recordFrom,
} from './state.js';
import * as C from './canvas.js';
import {
  features, isScribble, isClosed, detectHook, detectDrawnHead, estimateBend, bendFromSagitta, markShape,
} from './gestures.js';
import * as G from './geom.js';
import { CELL_W, CELL_H } from './render.js';

const U = CELL_W;
const CHAIN_MS = 650; // wait for the next dash before finishing an arrow into empty space
const WRITE_MS = 1000; // pause that ends a handwritten label

let hooks = {};
let svg;
const active = new Map(); // pointerId → {x, y, type}
let g = null; // the gesture in progress
let pending = null; // {kind: 'chain'|'write', …}
let pendingTimer = 0;
let lastPenTime = -Infinity;
export let lastPointerType = 'mouse';
let spaceDown = false;

export function initPen(svgEl, h) {
  svg = svgEl;
  hooks = h;
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('pointerleave', () => {
    if (!g && app.hover) { app.hover = null; changed({ hover: true }); }
    if (!g) C.clearGhost();
  });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('dblclick', onDoubleClick);
  svg.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e.target)) { spaceDown = true; svg.classList.add('panning'); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; svg.classList.remove('panning'); }
  });
}

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

// ---------- pointer plumbing ----------

function onDown(ev) {
  const now = performance.now();
  if (ev.pointerType === 'pen') lastPenTime = now;
  // Palm rejection: while a stylus is in use, ignore touches.
  if (ev.pointerType === 'touch' && now - lastPenTime < 1500) return;
  if (hooks.isEditing()) hooks.commitEditor();
  lastPointerType = ev.pointerType;
  active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ev.pointerType });
  try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  ev.preventDefault();
  svg.focus({ preventScroll: true });

  if (ev.pointerType === 'touch' && active.size === 2) {
    // Second finger: pinch/pan. A just-started stroke is abandoned.
    if (g && (g.type === 'stroke' || g.type === 'sketch') && (now - g.t0 < 300 || G.pathLength(g.points) < 30 / app.view.k)) cancelGesture();
    if (!g) startPinch();
    return;
  }
  if (active.size > 1 || g) return;

  clearTimeout(pendingTimer);
  if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && spaceDown)) {
    g = { type: 'pan', pointerId: ev.pointerId, last: { x: ev.clientX, y: ev.clientY } };
    svg.classList.add('panning');
    return;
  }
  if (ev.button !== 0) return;
  const p = C.toWorld(ev.clientX, ev.clientY);
  if (app.tool === 'select') startSelectGesture(ev, p);
  else if (app.tool === 'sketch') startSketch(ev, p);
  else startStroke(ev, p);
}

function pointsOf(ev) {
  const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
  return (list.length ? list : [ev]).map((e) => C.toWorld(e.clientX, e.clientY));
}

function onMove(ev) {
  if (active.has(ev.pointerId)) active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ev.pointerType });
  if (!g) {
    if (ev.pointerType !== 'touch') hoverAt(C.toWorld(ev.clientX, ev.clientY));
    return;
  }
  if (g.type === 'pinch') { updatePinch(); return; }
  if (g.pointerId !== ev.pointerId) return;
  switch (g.type) {
    case 'pan': {
      C.panBy(ev.clientX - g.last.x, ev.clientY - g.last.y);
      g.last = { x: ev.clientX, y: ev.clientY };
      break;
    }
    case 'stroke': moveStroke(ev); break;
    case 'sketch': {
      for (const p of pointsOf(ev)) addPoint(g.points, p);
      C.setLiveInk(g.points, 'ink-sketch');
      break;
    }
    case 'erase': eraseAt(C.toWorld(ev.clientX, ev.clientY)); break;
    case 'move': moveNodesTo(C.toWorld(ev.clientX, ev.clientY)); break;
    case 'bend': bendTo(C.toWorld(ev.clientX, ev.clientY)); break;
    case 'marquee': {
      g.end = C.toWorld(ev.clientX, ev.clientY);
      const a = g.start, b = g.end;
      C.setLasso([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
      break;
    }
    default:
  }
}

function onUp(ev) {
  active.delete(ev.pointerId);
  if (!g) return;
  if (g.type === 'pinch') {
    if (active.size < 2) { g = null; resumePending(); }
    return;
  }
  if (g.pointerId !== ev.pointerId) return;
  const gesture = g;
  g = null;
  svg.classList.toggle('panning', spaceDown);
  switch (gesture.type) {
    case 'stroke': endStroke(gesture); break;
    case 'sketch': endSketch(gesture); break;
    case 'erase': recordFrom(gesture.before); break;
    case 'move': endMove(gesture); break;
    case 'bend': endBend(gesture); break;
    case 'marquee': endMarquee(gesture, ev.shiftKey); break;
    default:
  }
  resumePending();
}

function onCancel(ev) {
  active.delete(ev.pointerId);
  if (g && (g.pointerId === ev.pointerId || g.type === 'pinch')) cancelGesture();
}

function cancelGesture() {
  if (!g) return;
  clearTimeout(g.longPress);
  if (g.before && (g.type === 'move' || g.type === 'bend' || g.type === 'erase')) {
    app.diagram.restore(g.before);
    changed({ diagram: true });
  }
  g = null;
  C.setLiveInk(null);
  C.setLasso(null);
  C.clearGhost();
  resumePending();
}

function addPoint(list, p) {
  const last = list[list.length - 1];
  if (!last || G.dist(last, p) >= 0.8 / app.view.k) list.push(p);
}

function onWheel(ev) {
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  if (ev.ctrlKey || ev.metaKey) C.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * unit * 0.0045));
  else C.panBy(-ev.deltaX * unit, -ev.deltaY * unit);
}

function startPinch() {
  const [a, b] = [...active.values()];
  const r = C.stageRect();
  g = {
    type: 'pinch',
    d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    m0: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
    v0: { ...app.view },
  };
  C.setLiveInk(null);
}

function updatePinch() {
  const pts = [...active.values()];
  if (pts.length < 2) return;
  const [a, b] = pts;
  const r = C.stageRect();
  const d1 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const m1 = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  const k = Math.min(3, Math.max(0.3, g.v0.k * (d1 / g.d0)));
  const wx = (g.m0.x - g.v0.x) / g.v0.k, wy = (g.m0.y - g.v0.y) / g.v0.k;
  C.setView(m1.x - wx * k, m1.y - wy * k, k);
}

function hoverAt(p) {
  let hover = null;
  const n = C.nodeAtPoint(p);
  if (n && C.onNodeBox(p, n, 10)) hover = { kind: 'node', id: n.id };
  else {
    const e = C.edgeAtPoint(p, 10 / app.view.k);
    if (e) hover = { kind: 'edge', id: e };
    else if (n) hover = { kind: 'node', id: n.id };
  }
  const same = (hover && app.hover && hover.kind === app.hover.kind && hover.id === app.hover.id) || (!hover && !app.hover);
  if (!same) { app.hover = hover; changed({ hover: true }); }
  if (app.tool === 'pen' && !hover && !pending) C.showCellHint(C.cellOf(p));
  else if (!pending) C.clearGhost();
}

function onDoubleClick(ev) {
  const p = C.toWorld(ev.clientX, ev.clientY);
  const n = C.nodeAtPoint(p);
  if (n && C.onNodeBox(p, n, 12)) { select({ nodes: [n.id] }); hooks.openLabelEditor({ kind: 'node', id: n.id }); return; }
  const e = C.edgeAtPoint(p, 12 / app.view.k);
  if (e) { select({ edges: [e] }); hooks.openLabelEditor({ kind: 'edge', id: e }); }
}

// ---------- pen tool ----------

function startStroke(ev, p) {
  const node = C.nodeAtPoint(p);
  g = { type: 'stroke', pointerId: ev.pointerId, points: [p], t0: performance.now(), startNode: node ? node.id : null, startClient: { x: ev.clientX, y: ev.clientY } };
  C.setLiveInk(g.points);
  if (node) {
    g.longPress = setTimeout(() => {
      if (!g || g.type !== 'stroke') return;
      const ids = app.selection.nodes.has(node.id) ? [...app.selection.nodes] : [node.id];
      if (!app.selection.nodes.has(node.id)) select({ nodes: [node.id] });
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* ignore */ } }
      C.setLiveInk(null);
      C.clearGhost();
      g = { type: 'move', pointerId: g.pointerId, ids, start: g.points[0], before: app.diagram.snapshot(), applied: { dc: 0, dr: 0 }, moved: false };
      hooks.hint('moving');
    }, 420);
  }
}

function moveStroke(ev) {
  for (const p of pointsOf(ev)) addPoint(g.points, p);
  if (g.longPress && Math.hypot(ev.clientX - g.startClient.x, ev.clientY - g.startClient.y) > 7) {
    clearTimeout(g.longPress);
    g.longPress = 0;
  }
  C.setLiveInk(g.points);
  const last = g.points[g.points.length - 1];
  const from = g.startNode || (pending && pending.kind === 'chain' && G.dist(g.points[0], pending.lastEnd) < U * 0.5 ? pending.from : null);
  if (from && !pending?.kind?.startsWith('write')) {
    const cell = C.cellOf(last);
    const n = C.nodeAtCell(cell);
    C.showGhost(from, { ...cell, nodeId: n ? n.id : null }, { dashed: !!(pending && pending.kind === 'chain') });
  } else if (!pending) {
    C.clearGhost();
  }
}

function endStroke(s) {
  clearTimeout(s.longPress);
  C.setLiveInk(null);
  C.clearGhost();
  const duration = performance.now() - s.t0;
  try {
    handleStroke(s.points, duration);
  } finally {
    if (!pending) hooks.hint(null);
  }
}

function handleStroke(raw, duration) {
  const f = features(raw, U);
  if (pending) {
    if (continuesPending(raw, f)) { extendPending(raw); return; }
    flushPending();
  }
  if (f.length <= 10 / app.view.k && duration < 650) { onTap(raw[0]); return; }
  // A zig-zag deletes what it covers; over empty paper it may just be handwriting (W, M, N).
  if (isScribble(f, U) && eraseUnder(raw)) return;
  const startNode = C.nodeAtPoint(raw[0]);
  if (f.diag < U * 0.36) { handleSmall(raw, f, startNode); return; }
  if (isClosed(f, U) && enclosesOtherNodes(raw, startNode)) { lassoSelect(raw); return; }
  if (startNode) { handleFromNode(raw, f, startNode); return; }
  if (isClosed(f, U)) { lassoSelect(raw); return; }
  const r0 = C.regionOf(raw[0]), r1 = C.regionOf(raw[raw.length - 1]);
  if (r0.col === r1.col && r0.row === r1.row) { startWriting({ cell: C.cellOf(raw[0]) }, raw); return; }
  const sc = C.cellOf(raw[0]), ec = C.cellOf(raw[raw.length - 1]);
  const endNode = C.nodeAtCell(ec);
  const info = arrowInfo(raw);
  let ids = null;
  commit((d) => {
    const a = d.addNode(sc.col, sc.row, '');
    const b = endNode ? d.node(endNode.id) : d.addNode(ec.col, ec.row, '');
    ids = { a: a.id, b: b.id, e: d.addEdge(a.id, b.id, edgeProps(info)).id };
  });
  app.marks.set(ids.e, { drawnHead: info.drawnHead, heads: 0 });
  select({ edges: [ids.e] });
}

function handleSmall(raw, f, startNode) {
  if (tryDecoration(raw)) return;
  if (tryCorner(raw)) return;
  const edgeId = labelZoneEdge(raw);
  if (edgeId) { startWriting({ edge: edgeId }, raw); return; }
  if (startNode) {
    if (!startNode.label.trim()) { startWriting({ node: startNode.id }, raw); return; }
    if (f.straightness > 0.75 && outward(raw, startNode)) { startChain(startNode, raw); return; }
    return;
  }
  startWriting({ cell: C.cellOf(raw[0]) }, raw);
}

function handleFromNode(raw, f, startNode) {
  const endNode = C.nodeAtPoint(raw[raw.length - 1]);
  const box = C.geo.layout.boxes.get(startNode.id);
  if (endNode && endNode.id === startNode.id) {
    let far = 0, farP = raw[0];
    for (const p of raw) {
      const d = G.dist(p, box);
      if (d > far) { far = d; farP = p; }
    }
    if (far > U * 0.33 && G.pathLength(raw) > U * 0.7) { addLoop(startNode, farP, box); return; }
    if (!startNode.label.trim()) { startWriting({ node: startNode.id }, raw); return; }
    if (f.straightness > 0.75 && outward(raw, startNode)) startChain(startNode, raw);
    return;
  }
  const info = arrowInfo(raw);
  let target = endNode && endNode.id !== startNode.id ? endNode : null;
  if (!target) {
    const tipNode = C.nodeAtPoint(raw[info.tip]);
    if (tipNode && tipNode.id !== startNode.id) target = tipNode;
  }
  if (target) { commitArrow(startNode, target, info); return; }
  startChain(startNode, raw, info);
}

function outward(raw, node) {
  const b = C.geo.layout.boxes.get(node.id);
  return G.dist(raw[raw.length - 1], b) > G.dist(raw[0], b) + 3;
}

function arrowInfo(raw) {
  const hook = detectHook(raw, U);
  const head = detectDrawnHead(raw, U);
  const tip = head >= 0 ? head : raw.length - 1;
  const main = raw.slice(hook ? hook.end : 0, tip + 1);
  return { hook, tip, ...estimateBend(main.length > 2 ? main : raw), drawnHead: head >= 0 };
}

function edgeProps(info, dashed = false) {
  return {
    bend: info.bend,
    looseness: info.looseness || 1,
    tail: info.hook ? (info.hook.side > 0 ? 'hook' : "hook'") : 'none',
    body: dashed ? 'dashed' : 'solid',
  };
}

function commitArrow(a, b, info, dashed = false) {
  let id;
  commit((d) => { id = d.addEdge(a.id, b.id, edgeProps(info, dashed)).id; });
  app.marks.set(id, { drawnHead: info.drawnHead, heads: 0 });
  select({ edges: [id] });
}

function addLoop(node, farP, center) {
  const v = G.sub(farP, center);
  let a = Math.round(-G.deg(Math.atan2(v.y, v.x)) / 45) * 45;
  a = ((a % 360) + 360) % 360;
  let id;
  commit((d) => { id = d.addEdge(node.id, node.id, { loop: a }).id; });
  select({ edges: [id] });
}

function onTap(p) {
  const n = C.nodeAtPoint(p);
  const sel = (kind, id) => (kind === 'node' ? app.selection.nodes.has(id) : app.selection.edges.has(id)) &&
    app.selection.nodes.size + app.selection.edges.size === 1;
  if (n && C.onNodeBox(p, n, 14)) { tapItem('node', n.id, sel('node', n.id)); return; }
  const e = C.edgeAtPoint(p, 12 / app.view.k);
  if (e) { tapItem('edge', e, sel('edge', e)); return; }
  if (n) { tapItem('node', n.id, sel('node', n.id)); return; }
  const cell = C.cellOf(p);
  let id;
  commit((d) => { id = d.addNode(cell.col, cell.row, '').id; });
  select({ nodes: [id] });
  hooks.openLabelEditor({ kind: 'node', id }, { isNew: true });
}

function tapItem(kind, id, alreadySelected) {
  if (alreadySelected) { hooks.openLabelEditor({ kind, id }); return; }
  select(kind === 'node' ? { nodes: [id] } : { edges: [id] });
  const item = kind === 'node' ? app.diagram.node(id) : null;
  if (item && !item.label.trim()) hooks.openLabelEditor({ kind, id });
}

// Small marks next to the ends of an arrow change its style: a bar at the tail gives ↦,
// a curl ↪, a chevron ↣; an extra chevron at the head gives ↠.
function tryDecoration(raw) {
  const shape = markShape(raw, U);
  const c = G.centroid(raw);
  let best = null;
  for (const e of app.diagram.edges) {
    if (e.kind !== 'arrow' || e.from === e.to) continue;
    const geom = C.geo.geoms.get(e.id);
    if (!geom) continue;
    for (const end of ['head', 'tail']) {
      const d = G.dist(c, end === 'head' ? geom.headPt : geom.tailPt);
      if (d < U * 0.3 && (!best || d < best.d)) best = { e, geom, end, d };
    }
  }
  if (!best) return false;
  const { e, geom, end } = best;
  const marks = app.marks.get(e.id) || { drawnHead: false, heads: 0, barbs: 0 };
  app.marks.set(e.id, marks);
  // Decorations sit on the arrow itself; marks off the line (like ⌟ inside a square) are not ours.
  const onLine = (p, tol = 0.13) => G.polylineDist(p, geom.poly) < U * tol;
  if (end === 'head') {
    const dir = geom.headDir;
    if (shape.type === 'zigzag' && onLine(c, 0.15)) return restyle(e, { head: 'epi' });
    if (shape.type === 'angle' && G.dot(shape.apexDir, dir) > 0.6 && onLine(shape.apex)) {
      if (marks.drawnHead || marks.heads >= 1) return restyle(e, { head: 'epi' });
      marks.heads = (marks.heads || 0) + 1; // the arrowhead itself, drawn separately
      return true;
    }
    if (shape.type === 'bar') {
      const cos = Math.abs(G.dot(shape.dir, dir));
      if (cos > 0.3 && cos < 0.97 && G.dist(c, geom.headPt) < U * 0.18) {
        marks.barbs = (marks.barbs || 0) + 1;
        if (marks.barbs >= 2) { marks.barbs = 0; marks.heads = (marks.heads || 0) + 1; }
        return true;
      }
    }
    return false;
  }
  const dir = geom.tailDir;
  if (shape.type === 'bar' && Math.abs(G.dot(shape.dir, dir)) < 0.45 && onLine(shape.mid)) return restyle(e, { tail: 'mapsto' });
  if (shape.type === 'curl' && G.dist(c, geom.tailPt) < U * 0.2) {
    const side = G.dot(G.sub(shape.c, geom.tailPt), G.leftNormal(dir)) >= 0 ? 'hook' : "hook'";
    return restyle(e, { tail: side });
  }
  if (shape.type === 'angle' && G.dot(shape.apexDir, dir) > 0.6 && onLine(shape.apex)) return restyle(e, { tail: 'mono' });
  return false;
}

function restyle(e, patch) {
  commit((d) => Object.assign(d.edge(e.id), patch));
  select({ edges: [e.id] });
  return true;
}

// An ⌟-shaped mark inside a square, next to an object, adds the pullback corner.
function tryCorner(raw) {
  const shape = markShape(raw, U);
  if (shape.type !== 'angle' || shape.turn < 55 || shape.turn > 140) return false;
  const ax = shape.apexDir.x, ay = shape.apexDir.y;
  if (Math.abs(ax) < 0.3 || Math.abs(ay) < 0.3) return false;
  const sx = Math.sign(ax), sy = Math.sign(ay);
  const c = G.centroid(raw);
  let best = null;
  for (const n of app.diagram.nodes) {
    const b = C.geo.layout.boxes.get(n.id);
    const v = G.sub(c, b);
    if (Math.sign(v.x) !== sx || Math.sign(v.y) !== sy) continue;
    // The mark sits in the square's corner region, clear of the label (not written over it).
    if (Math.abs(v.x) < U * 0.1 || Math.abs(v.y) < U * 0.1 || C.onNodeBox(c, n, 2)) continue;
    const d = G.len(v);
    if (d < U * 0.8 && (!best || d < best.d)) best = { n, d };
  }
  if (!best) return false;
  const n = best.n;
  let id = null;
  commit((d) => {
    const t = d.nodeNear(n.col + sx, n.row + sy, 0.75) || d.addNode(n.col + sx, n.row + sy, '');
    const existing = d.edges.find((e) => e.kind === 'corner' && e.from === n.id);
    if (existing) { existing.to = t.id; id = existing.id; } else id = d.addEdge(n.id, t.id, { kind: 'corner' }).id;
  });
  select({ edges: [id] });
  return true;
}

function labelZoneEdge(raw) {
  const c = G.centroid(raw);
  const n = C.nodeAtPoint(c);
  if (n && C.onNodeBox(c, n, 10)) return null;
  let best = null;
  for (const [id, geom] of C.geo.geoms) {
    const e = app.diagram.edge(id);
    if (!e || e.kind === 'corner') continue;
    let bi = 0, bd = Infinity;
    geom.poly.forEach((p, i) => {
      const d = G.dist(c, p);
      if (d < bd) { bd = d; bi = i; }
    });
    const t = bi / (geom.poly.length - 1);
    const inMiddle = e.from === e.to || (t > 0.18 && t < 0.82);
    if (bd < U * 0.42 && inMiddle && (!best || bd < best.d)) best = { id, d: bd };
  }
  return best ? best.id : null;
}

function eraseUnder(raw) {
  const nodes = [], edges = [];
  for (const n of app.diagram.nodes) {
    const b = C.geo.layout.boxes.get(n.id);
    let inside = 0;
    for (const p of raw) if (Math.abs(p.x - b.x) <= b.hw + 8 && Math.abs(p.y - b.y) <= b.hh + 8) inside++;
    if (inside >= Math.max(3, raw.length * 0.25)) nodes.push(n.id);
  }
  // An arrow is hit when the scribble crosses it twice or covers a stretch of it.
  const bb = G.bboxOf(raw);
  const mx = bb.w * 0.1, my = bb.h * 0.1;
  const covered = (p) => p.x >= bb.x0 + mx && p.x <= bb.x1 - mx && p.y >= bb.y0 + my && p.y <= bb.y1 - my;
  for (const [id, geom] of C.geo.geoms) {
    if (G.polylineCrossings(raw, geom.poly) >= 2 || geom.poly.filter(covered).length >= 2) { edges.push(id); continue; }
    const l = geom.label;
    if (l) {
      let inside = 0;
      for (const p of raw) if (Math.abs(p.x - l.x) <= l.w / 2 + 6 && Math.abs(p.y - l.y) <= l.h / 2 + 6) inside++;
      if (inside >= Math.max(3, raw.length * 0.3)) edges.push(id);
    }
  }
  if (!nodes.length && !edges.length) return false;
  commit((d) => {
    for (const id of edges) d.removeEdge(id);
    for (const id of nodes) d.removeNode(id);
  });
  hooks.toast('deleted');
  return true;
}

function enclosesOtherNodes(raw, startNode) {
  return app.diagram.nodes.some((n) => (!startNode || n.id !== startNode.id) && G.pointInPolygon(C.geo.layout.boxes.get(n.id), raw));
}

function lassoSelect(raw) {
  const nodes = app.diagram.nodes.filter((n) => G.pointInPolygon(C.geo.layout.boxes.get(n.id), raw)).map((n) => n.id);
  const set = new Set(nodes);
  const edges = app.diagram.edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => e.id);
  if (nodes.length) select({ nodes, edges });
  else clearSelection();
}

// ---------- pending strokes: dash chains and handwriting ----------

function startChain(node, raw, info = arrowInfo(raw)) {
  pending = {
    kind: 'chain', from: node.id, strokes: [raw], info,
    lastEnd: raw[raw.length - 1], dir: G.norm(G.sub(raw[raw.length - 1], raw[0])),
  };
  showPending();
  hooks.hint('chain');
}

function startWriting(target, raw) {
  pending = { kind: 'write', target, strokes: [raw], bbox: G.bboxOf(raw) };
  showPending();
  hooks.hint('writing');
}

function showPending() {
  C.setPendingInk(pending ? pending.strokes : null);
  if (pending && pending.kind === 'chain') {
    const cell = C.cellOf(pending.lastEnd);
    const n = C.nodeAtCell(cell);
    C.showGhost(pending.from, { ...cell, nodeId: n ? n.id : null }, { dashed: pending.strokes.length > 1 });
  }
}

function continuesPending(raw, f) {
  if (pending.kind === 'chain') {
    if (G.dist(raw[0], pending.lastEnd) > U * 0.5 || f.straightness < 0.6) return false;
    return G.dot(G.norm(G.sub(raw[raw.length - 1], raw[0])), pending.dir) > 0.35;
  }
  const b = pending.bbox, m = U * 0.35, s = raw[0];
  const near = s.x >= b.x0 - m && s.x <= b.x1 + m && s.y >= b.y0 - m && s.y <= b.y1 + m;
  return near && f.diag < U * 1.1;
}

function extendPending(raw) {
  pending.strokes.push(raw);
  if (pending.kind === 'chain') {
    const first = pending.strokes[0][0];
    pending.lastEnd = raw[raw.length - 1];
    pending.dir = G.norm(G.sub(pending.lastEnd, first));
    const end = C.nodeAtPoint(pending.lastEnd);
    if (end && end.id !== pending.from) { flushPending(); return; }
  } else {
    pending.bbox = G.bboxOf([...pending.strokes.flat()]);
  }
  showPending();
}

function resumePending() {
  if (!pending) return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPending, pending.kind === 'chain' ? CHAIN_MS : WRITE_MS);
}

export function hasPending() {
  return !!pending;
}

export function flushPending() {
  clearTimeout(pendingTimer);
  const p = pending;
  pending = null;
  C.setPendingInk(null);
  C.clearGhost();
  hooks.hint(null);
  if (!p) return;
  if (p.kind === 'write') { hooks.onHandwriting(p); return; }
  const from = app.diagram.node(p.from);
  if (!from) return;
  const all = p.strokes.flat();
  const endCell = C.cellOf(p.lastEnd);
  if (Math.abs(endCell.col - from.col) < 0.5 && Math.abs(endCell.row - from.row) < 0.5) return;
  const dashed = p.strokes.length > 1;
  const info = dashed ? { ...p.info, ...estimateBend(all) } : p.info;
  const target = C.nodeAtCell(endCell);
  if (target) { commitArrow(from, target, info, dashed); return; }
  let ids;
  commit((d) => {
    const b = d.addNode(endCell.col, endCell.row, '');
    ids = { b: b.id, e: d.addEdge(from.id, b.id, edgeProps(info, dashed)).id };
  });
  app.marks.set(ids.e, { drawnHead: info.drawnHead, heads: 0 });
  select({ edges: [ids.e] });
  if (lastPointerType === 'mouse') hooks.openLabelEditor({ kind: 'node', id: ids.b }, { isNew: true });
}

export function cancelPending() {
  clearTimeout(pendingTimer);
  pending = null;
  C.setPendingInk(null);
  C.clearGhost();
  hooks.hint(null);
}

// ---------- select tool ----------

function startSelectGesture(ev, p) {
  const n = C.nodeAtPoint(p);
  const onBox = n && C.onNodeBox(p, n, 16);
  const e = onBox ? null : C.edgeAtPoint(p, 12 / app.view.k);
  if (n && (onBox || !e)) {
    if (ev.shiftKey) {
      if (app.selection.nodes.has(n.id)) app.selection.nodes.delete(n.id); else app.selection.nodes.add(n.id);
      changed({ selection: true });
    } else if (!app.selection.nodes.has(n.id)) {
      select({ nodes: [n.id] });
    }
    g = { type: 'move', pointerId: ev.pointerId, ids: [...app.selection.nodes], start: p, before: app.diagram.snapshot(), applied: { dc: 0, dr: 0 }, moved: false };
    return;
  }
  if (e) {
    select({ edges: [e] }, ev.shiftKey);
    g = { type: 'bend', pointerId: ev.pointerId, edgeId: e, start: p, before: app.diagram.snapshot(), moved: false };
    return;
  }
  if (!ev.shiftKey) clearSelection();
  g = { type: 'marquee', pointerId: ev.pointerId, start: p, end: p };
}

function moveNodesTo(p) {
  const step = C.moveStep();
  const dc = Math.round((p.x - g.start.x) / CELL_W / step) * step;
  const dr = Math.round((p.y - g.start.y) / CELL_H / step) * step;
  if (dc === g.applied.dc && dr === g.applied.dr) return;
  const d = app.diagram;
  d.restore(g.before);
  if (d.canMove(g.ids, dc, dr)) {
    d.moveNodes(g.ids, dc, dr);
    g.applied = { dc, dr };
  } else {
    d.moveNodes(g.ids, g.applied.dc, g.applied.dr);
  }
  g.moved = true;
  changed({ diagram: true, quiet: true });
}

function endMove(s) {
  hooks.hint(null);
  if (s.moved) recordFrom(s.before);
}

function bendTo(p) {
  const e = app.diagram.edge(g.edgeId);
  if (!e) return;
  if (!g.moved && G.dist(p, g.start) < 6 / app.view.k) return;
  g.moved = true;
  const A = C.geo.layout.boxes.get(e.from), B = C.geo.layout.boxes.get(e.to);
  if (e.from === e.to) {
    let a = Math.round(-G.deg(Math.atan2(p.y - A.y, p.x - A.x)) / 45) * 45;
    e.loop = ((a % 360) + 360) % 360;
  } else {
    const h = G.dot(G.sub(p, A), G.leftNormal(G.sub(B, A)));
    Object.assign(e, bendFromSagitta(h, G.dist(A, B), 0.04));
    if (e.bend) e.shift = null;
  }
  changed({ diagram: true, quiet: true });
}

function endBend(s) {
  if (s.moved) recordFrom(s.before);
}

function endMarquee(s, additive) {
  C.setLasso(null);
  const x0 = Math.min(s.start.x, s.end.x), x1 = Math.max(s.start.x, s.end.x);
  const y0 = Math.min(s.start.y, s.end.y), y1 = Math.max(s.start.y, s.end.y);
  if (x1 - x0 < 4 && y1 - y0 < 4) return;
  const nodes = app.diagram.nodes.filter((n) => {
    const b = C.geo.layout.boxes.get(n.id);
    return b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1;
  }).map((n) => n.id);
  const set = new Set([...nodes, ...(additive ? app.selection.nodes : [])]);
  const edges = app.diagram.edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => e.id);
  select({ nodes: [...set], edges });
}

// ---------- sketch tool ----------

function startSketch(ev, p) {
  if (app.eraser) {
    g = { type: 'erase', pointerId: ev.pointerId, before: app.diagram.snapshot() };
    eraseAt(p);
    return;
  }
  g = { type: 'sketch', pointerId: ev.pointerId, points: [p], t0: performance.now() };
  C.setLiveInk(g.points, 'ink-sketch');
}

function endSketch(s) {
  C.setLiveInk(null);
  const pts = s.points.length > 1 ? s.points : [s.points[0], { x: s.points[0].x + 0.5, y: s.points[0].y }];
  commit((d) => { d.ink.push({ id: d.newId('s'), points: pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })) }); });
}

function eraseAt(p) {
  const tol = 12 / app.view.k;
  const before = app.diagram.ink.length;
  app.diagram.ink = app.diagram.ink.filter((s) => G.polylineDist(p, s.points) > tol);
  if (app.diagram.ink.length !== before) changed({ diagram: true, quiet: true });
}
