// Compiles the exporters' output with pdflatex (needs a TeX installation with tikz-cd and xypic).
// Usage: node tests/latex-check.mjs [count] [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toTikzCD } from '../js/tikz.js';
import { toCD, toXymatrix } from '../js/formats.js';
import { EXAMPLES } from '../js/examples.js';
import { Diagram } from '../js/model.js';
import { randomDiagram } from './random-diagram.js';

const count = Number(process.argv[2] || 150);
const dir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'cd-latex-'));
fs.mkdirSync(dir, { recursive: true });

const diagrams = [...EXAMPLES.map((e) => new Diagram(e))];
for (let seed = 1; seed <= count; seed++) diagrams.push(randomDiagram(seed));

function compile(name, bodies) {
  const tex = [
    '\\documentclass{article}',
    '\\usepackage{amsmath,amssymb,amscd}',
    '\\usepackage{tikz-cd}',
    '\\usetikzlibrary{decorations.pathmorphing}',
    '\\usepackage[all]{xy}',
    '\\begin{document}',
    ...bodies.map((b, i) => `% diagram ${i}\n\\[\n${b}\n\\]\n`),
    '\\end{document}',
  ].join('\n');
  const file = path.join(dir, `${name}.tex`); // names must not shadow TeX files such as xymatrix.tex
  fs.writeFileSync(file, tex);
  try {
    execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], { cwd: dir, stdio: 'pipe' });
    return null;
  } catch (e) {
    const log = fs.readFileSync(path.join(dir, `${name}.log`), 'utf8');
    const i = log.indexOf('\n!');
    return log.slice(i, i + 600);
  }
}

let failed = 0;
for (const [name, fn] of [
  ['check-tikzcd', (d) => toTikzCD(d)],
  // xy-pic's loops break on some labels (its spline code), so loops are only checked in tikz-cd.
  ['check-xymatrix', (d) => (d.edges.some((e) => e.from === e.to) ? null : toXymatrix(d))],
  ['check-amscd', (d) => { const r = toCD(d); return r.ok ? r.code : null; }],
]) {
  const bodies = diagrams.map(fn).filter(Boolean);
  // Compile one by one only when the batch fails, to find the culprit.
  const err = compile(name, bodies);
  if (!err) { console.log(`${name}: ${bodies.length} diagrams compile`); continue; }
  for (let i = 0; i < bodies.length; i++) {
    const e = compile(`${name}-${i}`, [bodies[i]]);
    if (e) { failed++; console.log(`${name} #${i} fails:\n${bodies[i]}\n${e}\n`); break; }
  }
}
console.log(`output in ${dir}`);
process.exit(failed ? 1 : 0);
