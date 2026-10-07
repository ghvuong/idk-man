// Deterministic random diagrams for round-trip and LaTeX compile tests.
import { Diagram, HEADS, TAILS, BODIES } from '../js/model.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const LABELS = ['X', 'Y_1', 'A[x]/(x^3)', 'X \\times_Z Y', '\\mathcal{O}_X', 'M \\otimes_R N', '0', '\\cdots', 'A[[x]]', '\\operatorname{Spec} R', ''];
const ARROW_LABELS = ['', '', 'f', 'g \\circ f', '\\pi_1', 'f, g', 'A[x]', '\\alpha', '\\exists !'];

export function randomDiagram(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const d = new Diagram();
  const n = 2 + Math.floor(r() * 5);
  // A third of the diagrams use fine positions (quarter cells) on some objects.
  const fine = r() < 0.33;
  const coord = (max) => Math.floor(r() * max) + (fine && r() < 0.4 ? pick([0.25, 0.5, 0.75]) : 0);
  for (let i = 0; i < n; i++) d.addNode(coord(4), coord(3), pick(LABELS));
  const nodes = d.nodes;
  const m = Math.floor(r() * 7);
  for (let i = 0; i < m; i++) {
    const a = pick(nodes), b = r() < 0.12 ? a : pick(nodes);
    const kind = a === b ? 'arrow' : r() < 0.08 ? 'phantom' : 'arrow';
    d.addEdge(a.id, b.id, {
      kind,
      label: pick(ARROW_LABELS),
      side: pick(['left', 'right', 'over']),
      head: pick(HEADS),
      tail: pick(TAILS),
      body: pick(BODIES),
      double: r() < 0.15,
      bend: r() < 0.3 ? pick([-90, -60, -30, -15, 20, 30, 45, 90]) : 0,
      looseness: r() < 0.5 ? 1 : pick([1.3, 1.6, 2]),
      shift: r() < 0.1 ? pick([-2, -1, 1, 2]) : null,
      loop: pick([0, 45, 90, 180, 270]),
    });
  }
  // A corner mark now and then.
  if (r() < 0.3 && nodes.length) {
    const p = nodes[0];
    const t = d.nodeAt(p.col + 1, p.row + 1) || d.addNode(p.col + 1, p.row + 1, '');
    d.addEdge(p.id, t.id, { kind: 'corner' });
  }
  return d;
}
