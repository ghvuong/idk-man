// Unit tests for the LaTeX/quiver exporters and the tikz-cd parser (DOM-free modules).
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagram } from '../js/model.js';
import { toTikzCD, parseTikzCD, quoteLabel, directionLetters } from '../js/tikz.js';
import { toCD, toXymatrix, toQuiverURL } from '../js/formats.js';
import { EXAMPLES } from '../js/examples.js';
import { randomDiagram } from './random-diagram.js';

test('Vakil 1.3.B diagram exports like hand-written tikz-cd', () => {
  assert.equal(toTikzCD(new Diagram(EXAMPLES[0])), [
    '\\begin{tikzcd}',
    '  X_1 \\arrow[dr] \\\\',
    '  & Y \\arrow[r] & Z \\\\',
    '  X_2 \\arrow[ur]',
    '\\end{tikzcd}',
  ].join('\n'));
});

test('direction letters and label quoting', () => {
  assert.equal(directionLetters(2, -1), 'urr');
  assert.equal(directionLetters(-1, 0), 'l');
  assert.equal(quoteLabel('f'), '"f"');
  assert.equal(quoteLabel('A[x]'), '"{A[x]}"');
  assert.equal(quoteLabel('f, g'), '"{f, g}"');
});

test('styles map to tikz-cd options', () => {
  const d = new Diagram();
  const a = d.addNode(0, 0, 'A'), b = d.addNode(1, 0, 'B'), c = d.addNode(0, 1, 'C');
  d.addEdge(a.id, b.id, { tail: 'hook', label: '\\iota', side: 'right' });
  d.addEdge(a.id, c.id, { head: 'epi', body: 'dashed', bend: -45 });
  d.addEdge(b.id, c.id, { double: true, head: 'none' });
  d.addEdge(c.id, c.id, { loop: 180, label: 'f' });
  const out = toTikzCD(d);
  assert.match(out, /A \\arrow\[r, hook, "\\iota"'\] \\arrow\[d, dashed, two heads, bend right=45\]/);
  assert.match(out, /B \\arrow\[dl, equal\]/);
  assert.match(out, /C \\arrow\[loop, distance=2em, in=145, out=215, "f"\]/);
});

test('parallel arrows are spread with shift left/right', () => {
  const d = new Diagram();
  const a = d.addNode(0, 0, 'A'), b = d.addNode(1, 0, 'B');
  d.addEdge(a.id, b.id, { label: 'f' });
  d.addEdge(a.id, b.id, { label: 'g', side: 'right' });
  assert.match(toTikzCD(d), /\\arrow\[r, shift left, "f"\] \\arrow\[r, shift right, "g"'\]/);
});

test('corner marks reach empty cells, which are materialised with {}', () => {
  const d = new Diagram();
  const p = d.addNode(0, 0, 'P'), e = d.addNode(1, 1, '');
  d.addEdge(p.id, e.id, { kind: 'corner' });
  assert.equal(toTikzCD(d), '\\begin{tikzcd}\n  P \\arrow[dr, phantom, "\\lrcorner", very near start] \\\\\n  & {}\n\\end{tikzcd}');
});

test('parser reads quiver output', () => {
  const { diagram } = parseTikzCD(String.raw`\[\begin{tikzcd}
	{X_1} \\
	& Y & Z \\
	{X_2}
	\arrow["f", hook, from=1-1, to=2-2]
	\arrow[from=3-1, to=2-2]
	\arrow["\lrcorner"{anchor=center, pos=0.125}, draw=none, from=1-1, to=2-2]
	\arrow["{A[x]}"', curve={height=-12pt}, from=2-2, to=2-3]
\end{tikzcd}\]`);
  assert.equal(toTikzCD(diagram), [
    '\\begin{tikzcd}',
    '  X_1 \\arrow[dr, hook, "f"] \\arrow[dr, phantom, "\\lrcorner", very near start] \\\\',
    '  & Y \\arrow[r, bend left=15, "{A[x]}"\'] & Z \\\\',
    '  X_2 \\arrow[ur]',
    '\\end{tikzcd}',
  ].join('\n'));
});

test('parser reads old-style \\arrow{r}{f} and keeps unknown options', () => {
  const { diagram } = parseTikzCD('\\begin{tikzcd} A \\arrow{r}{f} & B \\arrow[l, crossing over, red] \\end{tikzcd}');
  const out = toTikzCD(diagram);
  // Opposite arrows between the same objects are spread apart automatically.
  assert.match(out, /A \\arrow\[r, shift left, "f"\]/);
  assert.match(out, /B \\arrow\[l, shift left, crossing over, red\]/);
});

test('export → parse → export is stable on random diagrams', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const d = randomDiagram(seed);
    const once = toTikzCD(d);
    const twice = toTikzCD(parseTikzCD(once).diagram);
    assert.equal(twice, once, `seed ${seed}`);
  }
});

test('amscd export for a square, and refusal for diagonals', () => {
  const d = new Diagram();
  const a = d.addNode(0, 0, 'A'), b = d.addNode(1, 0, 'B'), c = d.addNode(0, 1, 'C'), e = d.addNode(1, 1, 'D');
  d.addEdge(a.id, b.id, { label: 'f' });
  d.addEdge(a.id, c.id, { label: 'g' });
  d.addEdge(e.id, b.id, { label: 'h', side: 'right' });
  d.addEdge(c.id, e.id, { double: true, head: 'none' });
  assert.deepEqual(toCD(d), {
    ok: true,
    dropped: 0,
    code: '\\begin{CD}\n  A @>{f}>> B \\\\\n  @VV{g}V @AA{h}A \\\\\n  C @= D\n\\end{CD}',
  });
  d.addEdge(a.id, e.id);
  assert.equal(toCD(d).ok, false);
});

test('xymatrix export', () => {
  const out = toXymatrix(new Diagram(EXAMPLES[2]));
  assert.match(out, /\\ar@\/\^\/\[drr\]\^\{b\}/);
  assert.match(out, /\\ar@\{-->\}\[dr\]\^\{\\exists !\}/);
  assert.match(out, /\\ar@\{\}\[dr\]\|\(\.2\)\{\\lrcorner\}/);
});

test('quiver link encodes quiver format version 0', () => {
  const url = toQuiverURL(new Diagram(EXAMPLES[0]));
  const json = JSON.parse(Buffer.from(url.split('#q=')[1], 'base64').toString('utf8'));
  assert.deepEqual(json, [0, 4, [0, 0, 'X_1'], [1, 1, 'Y'], [2, 1, 'Z'], [0, 2, 'X_2'], [0, 1], [3, 1], [1, 2]]);
});
