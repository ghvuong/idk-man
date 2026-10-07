// Diagram model: objects sit on an integer grid (col, row), arrows join them.
// Raw ink strokes (for handwriting recognition) live alongside.

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
      const node = { id: String(n.id), col: Math.round(n.col) || 0, row: Math.round(n.row) || 0, label: String(n.label ?? '') };
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

  addNode(col, row, label = '') {
    const existing = this.nodeAt(col, row);
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
      const other = this.nodeAt(n.col + dc, n.row + dr);
      if (other && !moving.has(other.id)) return false;
    }
    return true;
  }

  moveNodes(ids, dc, dr) {
    if (!this.canMove(ids, dc, dr)) return false;
    for (const id of ids) {
      const n = this.node(id);
      if (n) { n.col += dc; n.row += dr; }
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
