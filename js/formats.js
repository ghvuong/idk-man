// Other outputs: amscd's CD environment (renders in KaTeX/MathJax), xy-pic's \xymatrix,
// and a link that opens the diagram in quiver (q.uiver.app).

import { Diagram } from './model.js';
import { directionLetters, cornerSymbol } from './tikz.js';

const asDiagram = (x) => (x instanceof Diagram ? x : new Diagram(x));

// ---------- amscd ----------
// Only square grids: arrows between neighbouring cells, plain or "=" style.
// Returns {ok: true, code} or {ok: false, reason} (reason is an i18n key).
export function toCD(input) {
  const d = asDiagram(input);
  if (!d.nodes.length) return { ok: true, code: '\\begin{CD}\n\\end{CD}' };
  const { cell, byCell, cols, rows } = matrixOf(d);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const slots = new Map();
  let dropped = 0;
  for (const e of d.edges) {
    const a = cell(byId.get(e.from)), z = cell(byId.get(e.to));
    const dc = z.col - a.col, dr = z.row - a.row;
    if (e.kind !== 'arrow') { dropped++; continue; } // CD has no corner marks or free labels
    if (e.from === e.to || Math.abs(dc) + Math.abs(dr) !== 1) return { ok: false, reason: 'cd.diagonal' };
    if (e.bend) return { ok: false, reason: 'cd.bend' };
    const plain = e.tail === 'none' && e.body === 'solid' && !e.extra.length;
    const eq = e.double && e.head === 'none';
    if (!plain || (!eq && (e.double || e.head !== 'to'))) return { ok: false, reason: 'cd.style' };
    // Slot key: the upper-left cell of the pair and the orientation.
    const horiz = dr === 0;
    const k = horiz ? `h:${Math.min(a.col, z.col)},${a.row}` : `v:${a.col},${Math.min(a.row, z.row)}`;
    if (slots.has(k)) return { ok: false, reason: 'cd.parallel' };
    slots.set(k, { e, forward: horiz ? dc > 0 : dr > 0, eq });
  }
  const lab = (t) => (t.trim() ? `{${t.trim()}}` : '');
  const objAt = (c, r) => {
    const n = byCell.get(`${c},${r}`);
    return n && n.label.trim() ? n.label.trim() : '{}';
  };
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      line += objAt(c, r);
      if (c < cols - 1) {
        const s = slots.get(`h:${c},${r}`);
        let arrow = '@.';
        if (s) {
          if (s.eq) arrow = '@=';
          else {
            // Default label side is left of travel: above for →, below for ←.
            const up = (s.e.side === 'right') !== !s.forward ? '' : lab(s.e.label);
            const down = (s.e.side === 'right') !== !s.forward ? lab(s.e.label) : '';
            arrow = s.forward ? `@>${up}>${down}>` : `@<${up}<${down}<`;
          }
        }
        line += ` ${arrow} `;
      }
    }
    lines.push(line);
    if (r < rows - 1) {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const s = slots.get(`v:${c},${r}`);
        if (!s) { cells.push('@.'); continue; }
        if (s.eq) { cells.push('@|'); continue; }
        // Left of travel is east for ↓ and west for ↑; CD puts its first label on the west.
        const west = (s.e.side === 'right') === s.forward ? lab(s.e.label) : '';
        const east = (s.e.side === 'right') === s.forward ? '' : lab(s.e.label);
        cells.push(s.forward ? `@V${west}V${east}V` : `@A${west}A${east}A`);
      }
      lines.push(cells.join(' '));
    }
  }
  return { ok: true, dropped, code: `\\begin{CD}\n${lines.map((l) => '  ' + l.trim()).join(' \\\\\n')}\n\\end{CD}` };
}

// The tikz-cd matrix cell of each object (Diagram.grid), for formats that only know a plain grid.
function matrixOf(d) {
  const gr = d.grid();
  const cell = (n) => ({ col: gr.col.index.get(n.col), row: gr.row.index.get(n.row) });
  const byCell = new Map(d.nodes.map((n) => { const c = cell(n); return [`${c.col},${c.row}`, n]; }));
  return { cell, byCell, cols: gr.col.count, rows: gr.row.count };
}

// ---------- xy-pic ----------

const XY_LOOPS = [
  [0, '(ur,dr)'], [90, '(ul,ur)'], [180, '(dl,ul)'], [270, '(dr,dl)'],
];

function xyStyle(e) {
  // xy-pic cannot draw double lines along loops (its spline code breaks), so loops stay single.
  if (e.double && e.from !== e.to) return e.head === 'none' ? '=' : '=>';
  const tail = { none: '', hook: '^{(}', "hook'": '_{(}', mono: '>', mapsto: '|' }[e.tail];
  const body = { solid: '-', dashed: '--', dotted: '.', squiggly: '~' }[e.body];
  const head = { to: '>', epi: '>>', none: '', harpoon: '^{>}', "harpoon'": '_{>}' }[e.head];
  const s = tail + body + head;
  return s === '->' ? '' : s;
}

export function toXymatrix(input) {
  const d = asDiagram(input);
  if (!d.nodes.length) return '\\xymatrix{\n}';
  const { cell, rows } = matrixOf(d);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const shifts = d.shifts();
  const content = new Map();
  const need = d.nodes.map(cell);
  // Empty objects become "{}" so that no row is left blank (a blank line would end the paragraph).
  for (const n of d.nodes) { const c = cell(n); content.set(`${c.col},${c.row}`, n.label.trim() || '{}'); }
  for (const e of d.edges) {
    const a = cell(byId.get(e.from)), z = cell(byId.get(e.to));
    const dir = directionLetters(z.col - a.col, z.row - a.row);
    let ar;
    if (e.kind === 'corner') {
      ar = `\\ar@{}[${dir}]|(.2){${cornerSymbol(z.col - a.col, z.row - a.row)}}`;
    } else if (e.kind === 'phantom') {
      ar = `\\ar@{}[${dir}]${e.label.trim() ? `|{${e.label.trim()}}` : ''}`;
    } else {
      const style = xyStyle(e);
      let mods = style ? `@{${style}}` : '';
      if (e.from === e.to) {
        const best = XY_LOOPS.reduce((p, q) => (Math.abs(((e.loop - q[0] + 540) % 360) - 180) < Math.abs(((e.loop - p[0] + 540) % 360) - 180) ? q : p));
        mods += `@${best[1]}`;
      } else if (e.bend) {
        const strength = Math.abs(e.bend) * e.looseness;
        const amount = strength >= 45 ? `${(strength / 30).toFixed(1)}pc` : '';
        mods += `@/${e.bend > 0 ? '^' : '_'}${amount}/`;
      }
      const sh = shifts.get(e.id) || 0;
      if (sh) mods += `@<${(sh * 0.5).toFixed(1)}ex>`;
      ar = `\\ar${mods}[${e.from === e.to ? '' : dir}]`;
      if (e.label.trim()) {
        const mark = e.side === 'right' ? '_' : e.side === 'over' ? '|' : '^';
        ar += `${mark}{${e.label.trim()}}`;
      }
    }
    const k = `${a.col},${a.row}`;
    content.set(k, `${content.get(k) || ''} ${ar}`.trim());
  }
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const cols = need.filter((c) => c.row === r).map((c) => c.col);
    const last = cols.length ? Math.max(...cols) : 0;
    const cells = [];
    for (let c = 0; c <= last; c++) cells.push(content.get(`${c},${r}`) || '');
    lines.push(cells.join(' & ').replace(/^\s+/, '').replace(/\s+&/g, ' &'));
  }
  return `\\xymatrix{\n${lines.map((l) => '  ' + l).join(' \\\\\n')}\n}`;
}

// ---------- quiver ----------
// Format (see quiver's src/quiver.mjs): base64 of JSON
// [0, |vertices|, ...[x, y, label], ...[source, target, label, alignment, options]].

export function toQuiverURL(input) {
  const d = asDiagram(input);
  if (!d.nodes.length) return 'https://q.uiver.app/';
  const { cell } = matrixOf(d);
  const index = new Map();
  const cells = [];
  d.nodes.forEach((n, i) => {
    index.set(n.id, i);
    const c = cell(n);
    const v = [c.col, c.row];
    if (n.label.trim()) v.push(n.label.trim());
    cells.push(v);
  });
  const shifts = d.shifts();
  for (const e of d.edges) {
    const options = {};
    const style = {};
    if (e.kind === 'corner') {
      style.name = 'corner';
    } else if (e.kind === 'phantom') {
      style.body = { name: 'none' };
      style.head = { name: 'none' };
    } else {
      if (e.tail === 'hook') style.tail = { name: 'hook', side: 'top' };
      else if (e.tail === "hook'") style.tail = { name: 'hook', side: 'bottom' };
      else if (e.tail === 'mono') style.tail = { name: 'mono' };
      else if (e.tail === 'mapsto') style.tail = { name: 'maps to' };
      if (e.body !== 'solid') style.body = { name: e.body };
      if (e.head === 'epi') style.head = { name: 'epi' };
      else if (e.head === 'none') style.head = { name: 'none' };
      else if (e.head === 'harpoon') style.head = { name: 'harpoon', side: 'top' };
      else if (e.head === "harpoon'") style.head = { name: 'harpoon', side: 'bottom' };
      if (e.double) options.level = 2;
    }
    if (e.from === e.to) {
      let a = Math.round(90 - e.loop);
      a = ((a + 540) % 360) - 180;
      if (a) options.angle = a;
    } else if (e.bend) {
      // quiver: one curve step ≈ 18° of bend; positive curve bows to the right.
      const strength = e.bend * (Math.abs(e.bend) >= 90 ? e.looseness : 1);
      options.curve = -Math.round(strength / 18) || -Math.sign(e.bend);
    }
    const sh = shifts.get(e.id) || 0;
    if (sh) options.offset = -Math.round(sh);
    if (Object.keys(style).length) options.style = style;
    const cell = [index.get(e.from), index.get(e.to)];
    const label = e.kind === 'corner' ? '' : e.label.trim();
    const alignment = e.side === 'right' ? 2 : e.side === 'over' ? 1 : 0;
    const hasOptions = Object.keys(options).length > 0;
    if (label || hasOptions) cell.push(label);
    if ((label && alignment) || hasOptions) cell.push(alignment);
    if (hasOptions) cell.push(options);
    cells.push(cell);
  }
  const json = JSON.stringify([0, d.nodes.length, ...cells]);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return `https://q.uiver.app/#q=${btoa(bin)}`;
}
