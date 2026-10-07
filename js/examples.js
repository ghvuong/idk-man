// Sample diagrams (the first one opens on a first visit).

const node = (id, col, row, label) => ({ id, col, row, label });
const edge = (id, from, to, props = {}) => ({ id, from, to, ...props });

export const EXAMPLES = [
  // Vakil, The Rising Sea, Exercise 1.3.B: X₁ ×_Y X₂ as the limit of this diagram.
  {
    nodes: [node('n1', 0, 0, 'X_1'), node('n2', 1, 1, 'Y'), node('n3', 2, 1, 'Z'), node('n4', 0, 2, 'X_2')],
    edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n4', 'n2'), edge('e3', 'n2', 'n3')],
    ink: [],
  },
  // Example 1.3.3: formal power series as a limit.
  {
    nodes: [
      node('n1', 1, 0, 'A[[x]]'), node('n2', 0, 1, '\\cdots'), node('n3', 1, 1, 'A[x]/(x^3)'),
      node('n4', 2, 1, 'A[x]/(x^2)'), node('n5', 3, 1, 'A[x]/(x)'),
    ],
    edges: [
      edge('e1', 'n1', 'n3'), edge('e2', 'n1', 'n4'), edge('e3', 'n1', 'n5'),
      edge('e4', 'n2', 'n3'), edge('e5', 'n3', 'n4'), edge('e6', 'n4', 'n5'),
    ],
    ink: [],
  },
  // Universal property of the fibre product.
  {
    nodes: [
      node('n1', 0, 0, 'T'), node('n2', 1, 1, 'X \\times_Z Y'), node('n3', 2, 1, 'Y'),
      node('n4', 1, 2, 'X'), node('n5', 2, 2, 'Z'),
    ],
    edges: [
      edge('e1', 'n1', 'n3', { bend: 20, label: 'b' }),
      edge('e2', 'n1', 'n4', { bend: -20, label: 'a', side: 'right' }),
      edge('e3', 'n1', 'n2', { body: 'dashed', label: '\\exists !' }),
      edge('e4', 'n2', 'n3', { label: 'p_2' }),
      edge('e5', 'n2', 'n4', { label: 'p_1', side: 'right' }),
      edge('e6', 'n3', 'n5', { label: 'g' }),
      edge('e7', 'n4', 'n5', { label: 'f', side: 'right' }),
      edge('e8', 'n2', 'n5', { kind: 'corner' }),
    ],
    ink: [],
  },
];
