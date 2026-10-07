// Diagram model: objects sit on a grid (col, row) in cell units, in steps of a quarter cell;
// arrows join them. Raw ink strokes (for handwriting recognition) live alongside.

export const HEADS = ['to', 'epi', 'none', 'harpoon', "harpoon'"];
export const TAILS = ['none', 'hook', "hook'", 'mono', 'mapsto'];
export const BODIES = ['solid', 'dashed', 'dotted', 'squiggly'];
export const SIDES = ['left', 'right', 'over'];
export const KINDS = ['arrow', 'corner', 'phantom'];

export const EDGE_DEFAULTS = Object.freeze({
  label: '',
  side: 'left',
  head: 'to',
  tail: 'none',
  body: 'solid',
  double: false,
  bend: 0, // degrees, positive = tikz-cd "bend left"
  looseness: 1, // tikz "looseness" for bends rounder than 90°
  shift: null, // null = automatic for parallel arrows; else integer units of tikz-cd "shift left"
  loop: 90, // loop direction in degrees (math convention, 90 = above); used when from === to
  kind: 'arrow', // 'arrow' | 'corner' (pullback/pushout mark) | 'phantom' (label only, e.g. ≅)
  extra: [], // tikz-cd options we do not understand, preserved verbatim on export
});

const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

export function normalizeEdge(e) {
  const out = {
    id: String(e.id),
    from: String(e.from),
    to: String(e.to),
    label: String(e.label ?? ''),
    side: pick(e.side, SIDES, 'left'),
    head: pick(e.head, HEADS, 'to'),
    tail: pick(e.tail, TAILS, 'none'),
    body: pick(e.body, BODIES, 'solid'),
    double: !!e.double,
    bend: clampBend(Number(e.bend) || 0),
    looseness: Math.min(4, Math.max(1, Math.round((Number(e.looseness) || 1) * 10) / 10)),
    shift: e.shift === null || e.shift === undefined || e.shift === '' ? null : Math.round(Number(e.shift)) || 0,
    loop: Number.isFinite(Number(e.loop)) ? Number(e.loop) : 90,
    kind: KINDS.includes(e.kind) ? e.kind : 'arrow',
    extra: Array.isArray(e.extra) ? e.extra.map(String) : [],
  };
  return out;
}

export function clampBend(b) {
  return Math.max(-90, Math.min(90, Math.round(b)));
}

// Positions snap to quarter cells.
export const snapQ = (v) => Math.round(v * 4) / 4;

// Two objects closer than this (in both directions, in cells) would overlap.
export const MIN_GAP = 0.5;

export function emptyDiagram() {
  return { nodes: [], edges: [], ink: [] };
}

export class Diagram {
  constructor(data) {
    this.load(data || emptyDiagram());
  }

  load(data) {
    const seen = new Set();
    this.nodes = [];
    for (const n of data.nodes || []) {
      const node = { id: String(n.id), col: snapQ(Number(n.col) || 0), row: snapQ(Number(n.row) || 0), label: String(n.label ?? '') };
      const key = `${node.col},${node.row}`;
      if (seen.has(key)) continue; // one object per cell
      seen.add(key);
      this.nodes.push(node);
    }
    const ids = new Set(this.nodes.map((n) => n.id));
    this.edges = (data.edges || []).map(normalizeEdge).filter((e) => ids.has(e.from) && ids.has(e.to));
    this.ink = (data.ink || []).map((s) => ({
      id: String(s.id),
      points: (s.points || []).map((p) => ({ x: +p.x, y: +p.y })),
    }));
    let max = 0;
    for (const x of [...this.nodes, ...this.edges, ...this.ink]) {
      const m = /(\d+)$/.exec(x.id);
      if (m) max = Math.max(max, +m[1]);
    }
    this.seq = max + 1;
  }

  toJSON() {
    return {
      nodes: this.nodes.map((n) => ({ ...n })),
      edges: this.edges.map((e) => ({ ...e, extra: [...e.extra] })),
      ink: this.ink.map((s) => ({ id: s.id, points: s.points.map((p) => ({ x: p.x, y: p.y })) })),
    };
  }

  snapshot() {
    return JSON.stringify(this.toJSON());
  }

  restore(snap) {
    this.load(JSON.parse(snap));
  }

  isEmpty() {
    return !this.nodes.length && !this.edges.length && !this.ink.length;
  }

  newId(prefix) {
    return prefix + this.seq++;
  }

  node(id) {
    return this.nodes.find((n) => n.id === id) || null;
  }

  edge(id) {
    return this.edges.find((e) => e.id === id) || null;
  }

  nodeAt(col, row) {
    return this.nodes.find((n) => n.col === col && n.row === row) || null;
  }

  // The object nearest to (col, row) that is within `tol` cells in both directions.
  nodeNear(col, row, tol = MIN_GAP, except = null) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      if (except && except.has(n.id)) continue;
      const dc = Math.abs(n.col - col), dr = Math.abs(n.row - row);
      if (dc < tol && dr < tol && dc + dr < bestD) { best = n; bestD = dc + dr; }
    }
    return best;
  }

  addNode(col, row, label = '') {
    col = snapQ(col);
    row = snapQ(row);
    const existing = this.nodeNear(col, row);
    if (existing) return existing;
    const node = { id: this.newId('n'), col, row, label };
    this.nodes.push(node);
    return node;
  }

  removeNode(id) {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
  }

  addEdge(from, to, props = {}) {
    const edge = normalizeEdge({ ...EDGE_DEFAULTS, ...props, id: this.newId('e'), from, to });
    this.edges.push(edge);
    return edge;
  }

  removeEdge(id) {
    this.edges = this.edges.filter((e) => e.id !== id);
  }

  edgesOf(nodeId) {
    return this.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  }

  // Can the given nodes move by (dc, dr) without landing on another object?
  canMove(ids, dc, dr) {
    const moving = new Set(ids);
    for (const id of ids) {
      const n = this.node(id);
      if (!n) continue;
      if (this.nodeNear(snapQ(n.col + dc), snapQ(n.row + dr), MIN_GAP, moving)) return false;
    }
    return true;
  }

  moveNodes(ids, dc, dr) {
    if (!this.canMove(ids, dc, dr)) return false;
    for (const id of ids) {
      const n = this.node(id);
      if (n) { n.col = snapQ(n.col + dc); n.row = snapQ(n.row + dr); }
    }
    return true;
  }

  // Grid extent of the objects (and of corner marks, whose targets may be empty cells).
  bounds() {
    if (!this.nodes.length) return null;
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
    for (const n of this.nodes) {
      c0 = Math.min(c0, n.col); c1 = Math.max(c1, n.col);
      r0 = Math.min(r0, n.row); r1 = Math.max(r1, n.row);
    }
    return { c0, r0, c1, r1 };
  }

  // The tikz-cd matrix behind the drawing. On an axis where objects are whole cells apart,
  // matrix columns (rows) are the cells themselves, empty ones included, as people
  // write tikz-cd by hand. Otherwise only occupied positions become columns (rows), and
  // gaps other than one cell become spacing adjustments in em: `&[Δ]` and `\\[Δ]`.
  grid() {
    const axis = (values, pitch, minAdjust) => {
      const uniq = [...new Set(values)].sort((a, b) => a - b);
      const index = new Map();
      if (!uniq.length) return { index, count: 0, adjust: [] };
      // Whole cells apart (wherever the first one sits): a plain matrix, empty cells included.
      const lo = uniq[0];
      if (uniq.every((v) => Number.isInteger(v - lo))) {
        const hi = uniq[uniq.length - 1];
        for (let v = lo; v <= hi; v++) index.set(v, v - lo);
        return { index, count: hi - lo + 1, adjust: new Array(hi - lo).fill(0) };
      }
      uniq.forEach((v, i) => index.set(v, i));
      const adjust = [];
      for (let i = 0; i + 1 < uniq.length; i++) {
        const gap = uniq[i + 1] - uniq[i];
        adjust.push(Math.max(minAdjust, Math.round((gap - 1) * pitch * 10) / 10) || 0);
      }
      return { index, count: uniq.length, adjust };
    };
    // Separations never drop below 0.8em: closer than that, TikZ fails on bent squiggly arrows.
    return {
      col: axis(this.nodes.map((n) => n.col), GRID_PITCH.col, -1.6),
      row: axis(this.nodes.map((n) => n.row), GRID_PITCH.row, -1.0),
    };
  }

  // Effective sideways shift of every arrow. Parallel straight arrows between the
  // same two objects are spread apart automatically unless a shift is set by hand.
  shifts() {
    const out = new Map();
    const groups = new Map();
    for (const e of this.edges) {
      if (e.shift !== null) { out.set(e.id, e.shift); continue; }
      out.set(e.id, 0);
      if (e.from === e.to || e.kind !== 'arrow' || e.bend !== 0) continue;
      const key = [e.from, e.to].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      const first = key.split('|')[0];
      list.forEach((e, i) => {
        const k = list.length - 1 - 2 * i; // n=2 → +1, -1; n=3 → +2, 0, -2
        out.set(e.id, e.from === first ? k : -k);
      });
    }
    return out;
  }
}

// One editor cell, in em of extra tikz-cd spacing: about what an empty column (row) adds.
export const GRID_PITCH = { col: 3.3, row: 2.5 };

export class History {
  constructor(limit = 300) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  record(snapshot) {
    if (this.past[this.past.length - 1] === snapshot) return;
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    while (this.past.length) {
      const s = this.past.pop();
      if (s !== current) {
        this.future.push(current);
        return s;
      }
    }
    return null;
  }

  redo(current) {
    if (!this.future.length) return null;
    const s = this.future.pop();
    this.past.push(current);
    return s;
  }
}
