// Draws a diagram as SVG: on the editor's grid, or with tikz-cd-like spacing for export.

import { measureTeX, texElement } from './math.js';
import * as G from './geom.js';

const NS = 'http://www.w3.org/2000/svg';

export const CELL_W = 128;
export const CELL_H = 104;

// Sizes are in pixels; `font` is 1em.
export const EDITOR_STYLE = {
  font: 21, labelScale: 0.74, stroke: 1.4, emptyR: 9, padX: 6, padY: 4, shiftUnit: 0.27,
  descriptionFill: 'var(--paper)', editor: true,
};
export const EXPORT_STYLE = {
  font: 20, labelScale: 0.72, stroke: 0.95, emptyR: 0, padX: 0, padY: 0, shiftUnit: 0.24,
  descriptionFill: '#fff', editor: false,
};

const el = (name, attrs = {}, parent = null) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
};

// ---------- layout ----------

export function editorLayout(d, style = EDITOR_STYLE) {
  const boxes = new Map();
  for (const n of d.nodes) {
    const x = n.col * CELL_W, y = n.row * CELL_H;
    if (n.label.trim()) {
      const m = measureTeX(n.label, style.font);
      boxes.set(n.id, { x, y, hw: m.w / 2 + style.padX, hh: m.h / 2 + style.padY, w: m.w, h: m.h });
    } else {
      boxes.set(n.id, { x, y, hw: style.emptyR, hh: style.emptyR, w: 0, h: 0 });
    }
  }
  return { boxes, cellXY: (c, r) => ({ x: c * CELL_W, y: r * CELL_H }) };
}

// The tikz-cd matrix (Diagram.grid) laid out like tikz-cd does it: columns as wide as their
// widest object, separated by column sep 2.4em and row sep 1.8em plus any spacing
// adjustments, cells with inner sep 1ex × 0.85ex.
export function tikzLayout(d, style = EXPORT_STYLE) {
  const em = style.font, ex = 0.4306 * em;
  const gr = d.grid();
  const sizes = new Map();
  for (const n of d.nodes) {
    const m = n.label.trim() ? measureTeX(n.label, style.font) : { w: 0, h: 0 };
    sizes.set(n.id, { w: m.w, h: m.h, hw: m.w / 2 + ex, hh: m.h / 2 + 0.85 * ex });
  }
  const colW = new Array(gr.col.count).fill(2 * ex), rowH = new Array(gr.row.count).fill(1.7 * ex);
  for (const n of d.nodes) {
    const s = sizes.get(n.id), c = gr.col.index.get(n.col), r = gr.row.index.get(n.row);
    colW[c] = Math.max(colW[c], 2 * s.hw);
    rowH[r] = Math.max(rowH[r], 2 * s.hh);
  }
  const place = (sizesAlong, sep, adjust) => {
    const pos = [];
    let at = 0;
    sizesAlong.forEach((w, i) => {
      pos.push(at + w / 2);
      at += w + (sep + (adjust[i] || 0)) * em;
    });
    return pos;
  };
  const xs = place(colW, 2.4, gr.col.adjust), ys = place(rowH, 1.8, gr.row.adjust);
  const boxes = new Map();
  for (const n of d.nodes) {
    const s = sizes.get(n.id);
    boxes.set(n.id, { x: xs[gr.col.index.get(n.col)], y: ys[gr.row.index.get(n.row)], hw: s.hw, hh: s.hh, w: s.w, h: s.h });
  }
  return { boxes };
}

// ---------- edge geometry ----------

export function edgeGeometry(d, layout, style) {
  const shifts = d.shifts();
  const out = new Map();
  for (const e of d.edges) {
    const A = layout.boxes.get(e.from), B = layout.boxes.get(e.to);
    if (!A || !B) continue;
    const geom = e.from === e.to ? loopGeometry(e, A, style) : pathGeometry(e, A, B, shifts.get(e.id) || 0, style);
    geom.id = e.id;
    placeLabel(e, geom, style);
    out.set(e.id, geom);
  }
  return out;
}

function pathGeometry(e, A, B, shift, style) {
  const pa = { x: A.x, y: A.y }, pb = { x: B.x, y: B.y };
  let curve;
  if (e.bend && e.kind === 'arrow') {
    const th = G.rad(e.bend);
    const a = G.angleOf(G.sub(pb, pa));
    const k = 0.3915 * G.dist(pa, pb) * (e.looseness || 1); // TikZ "bend" and "looseness"
    curve = [pa, G.add(pa, G.fromAngle(a - th, k)), G.add(pb, G.fromAngle(a + Math.PI + th, k)), pb];
  } else {
    curve = G.lineAsBezier(pa, pb);
  }
  const [t0, t1] = G.clipBezierToBoxes(curve, A, B);
  let vis = G.subBezier(curve, t0, t1);
  if (shift) {
    const n = G.leftNormal(G.sub(pb, pa));
    const off = G.mul(n, shift * style.shiftUnit * style.font);
    vis = vis.map((p) => G.add(p, off));
  }
  return finishGeometry(vis);
}

function loopGeometry(e, A, style) {
  const phi = -G.rad(e.loop); // screen angle of the loop's direction
  const spread = G.rad(35);
  const outA = phi - spread, inA = phi + spread;
  const start = G.boxBorderPoint(A, G.fromAngle(outA));
  const end = G.boxBorderPoint(A, G.fromAngle(inA));
  const D = 2 * style.font;
  const curve = [start, G.add(start, G.fromAngle(outA, D)), G.add(end, G.fromAngle(inA, D)), end];
  const g = finishGeometry(curve);
  g.outward = G.fromAngle(phi);
  return g;
}

function finishGeometry(curve) {
  return {
    curve,
    poly: G.sampleBezier(curve, 28),
    length: G.bezierLength(curve),
    tailPt: curve[0],
    tailDir: G.bezierTangent(curve, 0),
    headPt: curve[3],
    headDir: G.bezierTangent(curve, 1),
    mid: G.bezierPoint(curve, 0.5),
    midDir: G.bezierTangent(curve, 0.5),
  };
}

function placeLabel(e, g, style) {
  g.label = null;
  if (e.kind === 'corner') {
    const p = G.lerp(g.curve[0], g.curve[3], 0.125);
    const tex = cornerTeX(g);
    const m = measureTeX(tex, style.font);
    g.label = { tex, px: style.font, x: p.x, y: p.y, w: m.w, h: m.h, over: false };
    return;
  }
  const tex = e.label.trim();
  if (!tex) return;
  const px = e.kind === 'phantom' ? style.font : style.font * style.labelScale;
  const m = measureTeX(tex, px);
  if (e.kind === 'phantom' || e.side === 'over') {
    g.label = { tex, px, x: g.mid.x, y: g.mid.y, w: m.w, h: m.h, over: e.kind !== 'phantom' };
    return;
  }
  let n = g.outward || G.leftNormal(g.midDir);
  if (!g.outward && e.side === 'right') n = G.mul(n, -1);
  const ext = Math.abs(n.x) * m.w / 2 + Math.abs(n.y) * m.h / 2;
  const gap = 0.22 * px;
  g.label = { tex, px, x: g.mid.x + n.x * (gap + ext), y: g.mid.y + n.y * (gap + ext), w: m.w, h: m.h, over: false };
}

function cornerTeX(g) {
  const d = G.sub(g.curve[3], g.curve[0]);
  if (d.y >= 0) return d.x >= 0 ? '\\lrcorner' : '\\llcorner';
  return d.x >= 0 ? '\\urcorner' : '\\ulcorner';
}

// ---------- drawing ----------

function headShape(L, W) {
  return `M${-L} ${-W}C${-L * 0.55} ${-W * 0.38} ${-L * 0.18} ${-W * 0.08} 0 0C${-L * 0.18} ${W * 0.08} ${-L * 0.55} ${W * 0.38} ${-L} ${W}`;
}

function halfHead(L, W, side) {
  const s = side < 0 ? -1 : 1; // -1: left of travel (screen up for →)
  return `M${-L} ${s * W}C${-L * 0.55} ${s * W * 0.38} ${-L * 0.18} ${s * W * 0.08} 0 0`;
}

const fmt = (v) => Number(v.toFixed(2));

function placeAt(node, p, dir) {
  node.setAttribute('transform', `translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${fmt(G.deg(G.angleOf(dir)))})`);
  return node;
}

function squigglePath(curve, len, em) {
  const pre = 0.45 * em, post = 0.55 * em;
  const amp = 0.11 * em, wave = 0.42 * em;
  const pts = [G.bezierPoint(curve, 0)];
  const steps = Math.max(8, Math.ceil(len / 1.5));
  for (let i = 1; i <= steps; i++) {
    const s = (i / steps) * len;
    const t = G.bezierTAtLength(curve, s);
    const p = G.bezierPoint(curve, t);
    if (s > pre && s < len - post) {
      const n = G.leftNormal(G.bezierTangent(curve, t));
      const o = amp * Math.sin((2 * Math.PI * (s - pre)) / wave);
      pts.push({ x: p.x + n.x * o, y: p.y + n.y * o });
    } else {
      pts.push(p);
    }
  }
  return G.polyPath(pts);
}

function drawArrow(g, e, geom, style) {
  const em = style.font;
  const sw = style.stroke;
  const common = { fill: 'none', stroke: 'currentColor', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const ex = 0.4306 * em;
  const dash = e.body === 'dashed' ? `${fmt(0.8 * ex)} ${fmt(0.45 * ex)}` : e.body === 'dotted' ? `0.01 ${fmt(0.42 * ex)}` : null;
  const extra = dash ? { 'stroke-dasharray': dash } : {};
  if (e.body === 'dotted') extra['stroke-width'] = sw * 1.35;

  const curve = geom.curve;
  const len = geom.length;
  const L = 0.34 * em, W = 0.25 * em;

  if (e.double) {
    const gapD = 0.1 * em;
    const cut = e.head === 'none' ? 1 : G.bezierTAtLength(curve, Math.max(0, len - 0.17 * em));
    const body = G.subBezier(curve, 0, cut);
    for (const s of [-1, 1]) el('path', { d: G.bezierPath(G.offsetBezier(body, s * gapD)), ...common, ...extra }, g);
    if (e.head !== 'none') {
      placeAt(el('path', { d: headShape(0.32 * em, 0.36 * em), ...common }, g), geom.headPt, geom.headDir);
    }
  } else if (e.body === 'squiggly') {
    el('path', { d: squigglePath(curve, len, em), ...common }, g);
  } else {
    el('path', { d: G.bezierPath(curve), ...common, ...extra }, g);
  }

  if (!e.double) {
    if (e.head === 'to' || e.head === 'epi') placeAt(el('path', { d: headShape(L, W), ...common }, g), geom.headPt, geom.headDir);
    if (e.head === 'epi') {
      const t = G.bezierTAtLength(curve, Math.max(0, len - 0.24 * em));
      placeAt(el('path', { d: headShape(L, W), ...common }, g), G.bezierPoint(curve, t), G.bezierTangent(curve, t));
    }
    if (e.head === 'harpoon' || e.head === "harpoon'") {
      placeAt(el('path', { d: halfHead(L, W, e.head === 'harpoon' ? -1 : 1), ...common }, g), geom.headPt, geom.headDir);
    }
  }

  const r = 0.2 * em;
  if (e.tail === 'hook' || e.tail === "hook'") {
    const up = e.tail === 'hook';
    const d = up ? `M0 0A${fmt(r)} ${fmt(r)} 0 0 1 0 ${fmt(-2 * r)}` : `M0 0A${fmt(r)} ${fmt(r)} 0 0 0 0 ${fmt(2 * r)}`;
    placeAt(el('path', { d, ...common }, g), geom.tailPt, geom.tailDir);
  } else if (e.tail === 'mono') {
    const t = G.bezierTAtLength(curve, L * 0.95);
    placeAt(el('path', { d: headShape(L, W), ...common }, g), G.bezierPoint(curve, t), G.bezierTangent(curve, t));
  } else if (e.tail === 'mapsto') {
    placeAt(el('path', { d: `M0 ${fmt(-W)}L0 ${fmt(W)}`, ...common }, g), geom.tailPt, geom.tailDir);
  }
}

function drawLabel(parent, lab, style) {
  const r = texElement(lab.tex, lab.px);
  if (!r) return;
  if (lab.over) {
    const pad = 0.12 * lab.px;
    el('rect', {
      x: fmt(lab.x - r.w / 2 - pad), y: fmt(lab.y - r.h / 2 - pad),
      width: fmt(r.w + 2 * pad), height: fmt(r.h + 2 * pad), rx: fmt(pad), fill: style.descriptionFill,
    }, parent);
  }
  r.el.setAttribute('x', fmt(lab.x - r.w / 2));
  r.el.setAttribute('y', fmt(lab.y - r.h / 2));
  parent.appendChild(r.el);
}

// Draw the whole diagram into `root` (a <g>). Returns nothing; geometry comes from the caller.
export function drawDiagram(root, d, layout, geoms, style, opts = {}) {
  const sel = opts.selection || { nodes: new Set(), edges: new Set() };
  const hover = opts.hover || null;
  const edgeLayer = el('g', { class: 'edges' }, root);
  const nodeLayer = el('g', { class: 'nodes' }, root);
  const labelLayer = el('g', { class: 'edge-labels' }, root);

  for (const e of d.edges) {
    const geom = geoms.get(e.id);
    if (!geom) continue;
    const g = el('g', { class: 'edge', 'data-id': e.id }, edgeLayer);
    if (style.editor && (sel.edges.has(e.id) || (hover && hover.kind === 'edge' && hover.id === e.id))) {
      el('path', {
        d: G.bezierPath(geom.curve), class: sel.edges.has(e.id) ? 'edge-selected' : 'edge-hover',
        fill: 'none', 'stroke-linecap': 'round',
      }, g);
    }
    if (e.kind === 'arrow') drawArrow(g, e, geom, style);
    else if (style.editor) {
      // Phantom arrows and corner marks are invisible in print; hint at them while editing.
      el('path', { d: G.bezierPath(geom.curve), class: 'edge-phantom', fill: 'none' }, g);
    }
    if (geom.label) drawLabel(labelLayer, geom.label, style);
  }

  for (const n of d.nodes) {
    const b = layout.boxes.get(n.id);
    const g = el('g', { class: 'node', 'data-id': n.id }, nodeLayer);
    const selected = sel.nodes.has(n.id);
    const hovered = hover && hover.kind === 'node' && hover.id === n.id;
    if (style.editor && (selected || hovered)) {
      const p = 5;
      el('rect', {
        x: fmt(b.x - b.hw - p), y: fmt(b.y - b.hh - p), width: fmt(2 * (b.hw + p)), height: fmt(2 * (b.hh + p)),
        rx: 8, class: selected ? 'node-selected' : 'node-hover',
      }, g);
    }
    if (n.label.trim()) {
      const r = texElement(n.label, style.font);
      if (r && style.editor) {
        // Paper behind the label hides the grid dot at the cell centre.
        el('rect', { x: fmt(b.x - r.w / 2 - 2), y: fmt(b.y - r.h / 2 - 1), width: fmt(r.w + 4), height: fmt(r.h + 2), rx: 3, class: 'node-bg' }, g);
      }
      if (r) {
        r.el.setAttribute('x', fmt(b.x - r.w / 2));
        r.el.setAttribute('y', fmt(b.y - r.h / 2));
        g.appendChild(r.el);
      }
    } else if (style.editor) {
      el('circle', { cx: b.x, cy: b.y, r: style.emptyR - 2, class: 'node-empty' }, g);
    }
  }
}

// Bounding box of everything drawn, in layout coordinates.
export function sceneBounds(d, layout, geoms) {
  const pts = [];
  for (const b of layout.boxes.values()) {
    pts.push({ x: b.x - b.hw, y: b.y - b.hh }, { x: b.x + b.hw, y: b.y + b.hh });
  }
  for (const g of geoms.values()) {
    pts.push(...g.poly);
    if (g.label) {
      pts.push({ x: g.label.x - g.label.w / 2, y: g.label.y - g.label.h / 2 });
      pts.push({ x: g.label.x + g.label.w / 2, y: g.label.y + g.label.h / 2 });
    }
  }
  if (!pts.length) return null;
  return G.bboxOf(pts);
}

// Standalone SVG of the diagram with tikz-cd spacing. Returns {svg, width, height}.
export function exportSVG(d, { color = '#111', background = null, margin = 10 } = {}) {
  const style = EXPORT_STYLE;
  const layout = tikzLayout(d, style);
  const geoms = edgeGeometry(d, layout, style);
  const bb = sceneBounds(d, layout, geoms) || { x0: 0, y0: 0, w: 1, h: 1 };
  const width = Math.ceil(bb.w + 2 * margin), height = Math.ceil(bb.h + 2 * margin);
  const svg = el('svg', {
    xmlns: NS, viewBox: `${fmt(bb.x0 - margin)} ${fmt(bb.y0 - margin)} ${width} ${height}`,
    width, height, style: `color:${color}`,
  });
  if (background) {
    el('rect', { x: fmt(bb.x0 - margin), y: fmt(bb.y0 - margin), width, height, fill: background }, svg);
  }
  const root = el('g', {}, svg);
  drawDiagram(root, d, layout, geoms, style, {});
  return { svg, width, height };
}
