// tikz-cd export and import.

import { Diagram, EDGE_DEFAULTS, GRID_PITCH, snapQ } from './model.js';

// ---------- export ----------

export function directionLetters(dc, dr) {
  return (dr > 0 ? 'd'.repeat(dr) : 'u'.repeat(-dr)) + (dc > 0 ? 'r'.repeat(dc) : 'l'.repeat(-dc));
}

// Labels go inside "…"; braces protect characters that TikZ's key parser would split on.
export function quoteLabel(label) {
  const t = label.trim();
  return /[,=\[\]"']/.test(t) || t.includes('\\\\') ? `"{${t}}"` : `"${t}"`;
}

function cellLabel(label) {
  const t = label.trim();
  // "[" right after \\ would be read as a row-spacing argument.
  return t.includes('&') || t.startsWith('[') ? `{${t}}` : t;
}

const fmt = (n) => String(Math.round(n * 100) / 100);
const em = (x) => `${Math.round(x * 10) / 10}em`;

function mod360(a) {
  return ((Math.round(a) % 360) + 360) % 360;
}

// Corner symbol for a pullback/pushout mark pointing from its vertex into the square.
export function cornerSymbol(dc, dr) {
  if (dr >= 0) return dc >= 0 ? '\\lrcorner' : '\\llcorner';
  return dc >= 0 ? '\\urcorner' : '\\ulcorner';
}

export function arrowOptions(e, from, to, shift) {
  const opts = [];
  const loop = e.from === e.to;
  if (!loop) opts.push(directionLetters(to.col - from.col, to.row - from.row));

  if (e.kind === 'corner') {
    opts.push('phantom', `"${cornerSymbol(to.col - from.col, to.row - from.row)}"`, 'very near start');
    return opts;
  }
  if (e.kind === 'phantom') {
    opts.push('phantom');
    if (e.label.trim()) opts.push(quoteLabel(e.label));
    return opts.concat(e.extra);
  }

  if (e.tail === 'hook') opts.push('hook');
  else if (e.tail === "hook'") opts.push("hook'");
  else if (e.tail === 'mono') opts.push('tail');
  else if (e.tail === 'mapsto') opts.push('maps to');

  if (e.body === 'dashed') opts.push('dashed');
  else if (e.body === 'dotted') opts.push('dotted');
  else if (e.body === 'squiggly') opts.push('squiggly');

  if (e.double) opts.push(e.head === 'none' ? 'equal' : 'Rightarrow');
  else if (e.head === 'epi') opts.push('two heads');
  else if (e.head === 'none') opts.push('no head');
  else if (e.head === 'harpoon') opts.push('harpoon');
  else if (e.head === "harpoon'") opts.push("harpoon'");

  if (loop) {
    opts.push('loop', 'distance=2em', `in=${mod360(e.loop - 35)}`, `out=${mod360(e.loop + 35)}`);
  } else if (e.bend) {
    const side = e.bend > 0 ? 'left' : 'right';
    const a = Math.abs(e.bend);
    opts.push(a === 30 ? `bend ${side}` : `bend ${side}=${a}`);
    if (e.looseness !== 1) opts.push(`looseness=${fmt(e.looseness)}`);
  }
  if (shift) {
    const side = shift > 0 ? 'left' : 'right';
    const k = Math.abs(shift);
    opts.push(k === 1 ? `shift ${side}` : `shift ${side}=${fmt(k)}`);
  }
  opts.push(...e.extra);
  if (e.label.trim()) {
    let l = quoteLabel(e.label);
    if (e.side === 'right') l += "'";
    else if (e.side === 'over') l += ' description';
    opts.push(l);
  }
  return opts;
}

export function needsSquiggly(diagram) {
  return diagram.edges.some((e) => e.kind === 'arrow' && e.body === 'squiggly');
}

export function toTikzCD(input, { indent = '  ' } = {}) {
  const d = input instanceof Diagram ? input : new Diagram(input);
  if (!d.nodes.length) return '\\begin{tikzcd}\n\\end{tikzcd}';
  const shifts = d.shifts();
  const gr = d.grid();
  const at = (n) => ({ col: gr.col.index.get(n.col), row: gr.row.index.get(n.row) });
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  const content = new Map(); // "row,col" → text
  const key = (p) => `${p.row},${p.col}`;
  for (const n of d.nodes) content.set(key(at(n)), cellLabel(n.label));
  for (const e of d.edges) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) continue;
    const k = key(at(from));
    const arrow = `\\arrow[${arrowOptions(e, at(from), at(to), shifts.get(e.id) || 0).join(', ')}]`;
    const prev = content.get(k) || '';
    content.set(k, prev ? `${prev} ${arrow}` : arrow);
  }
  // An empty object still needs "{}" so tikz-cd creates its node (arrows may end there).
  for (const n of d.nodes) {
    const k = key(at(n));
    if (!content.get(k)) content.set(k, '{}');
  }

  // Column spacing adjustments only count in the first row, so it reaches the last of them.
  const lastAdjusted = gr.col.adjust.reduce((m, v, i) => (v ? i + 1 : m), 0);
  const lines = [];
  for (let r = 0; r < gr.row.count; r++) {
    let last = Math.max(-1, ...d.nodes.map(at).filter((p) => p.row === r).map((p) => p.col));
    if (r === 0) last = Math.max(last, lastAdjusted);
    let line = '';
    for (let c = 0; c <= last; c++) {
      if (c > 0) {
        const adj = r === 0 ? gr.col.adjust[c - 1] : 0;
        line += adj ? ` &[${em(adj)}] ` : ' & ';
      }
      line += content.get(key({ col: c, row: r })) || '';
    }
    lines.push(line.replace(/^\s+/, '').replace(/\s+&/g, ' &').replace(/\s+$/, ''));
  }
  const rowBreak = (i) => (gr.row.adjust[i] ? `\\\\[${em(gr.row.adjust[i])}]` : '\\\\');
  const body = lines.map((l, i) => indent + l + (i < lines.length - 1 ? (l ? ' ' : '') + rowBreak(i) : '')).join('\n');
  return `\\begin{tikzcd}\n${body}\n\\end{tikzcd}`;
}

// ---------- import ----------

// Split `s` on `sep` at brace depth 0 (and outside "quotes" when asked).
export function splitTop(s, sep, { quotes = false } = {}) {
  const out = [];
  let depth = 0, inQ = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && !inQ && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
      continue;
    }
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (quotes && ch === '"' && depth === 0) inQ = !inQ;
  }
  out.push(s.slice(start));
  return out;
}

function stripComments(src) {
  return src.split('\n').map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '%') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

// Read a balanced group starting at s[i] === open. Returns [inner, indexAfterClose].
// Inside [...], brackets within braces or "quotes" do not count.
function readBalanced(s, i, open, close) {
  let depth = 0, braces = 0, inQ = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') { j++; continue; }
    if (open === '{') {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
      continue;
    }
    if (ch === '{') { braces++; continue; }
    if (ch === '}') { braces--; continue; }
    if (braces > 0) continue;
    if (ch === '"') { inQ = !inQ; continue; }
    if (inQ) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

function unbrace(t) {
  t = t.trim();
  while (t.startsWith('{') && t.endsWith('}')) {
    const [inner, end] = readBalanced(t, 0, '{', '}');
    if (end !== t.length) break;
    t = inner.trim();
  }
  return t;
}

// Parse one quoted label option: "text"'  {opts} | "text" description …
function parseLabelOption(tok) {
  let i = 1, depth = 0;
  for (; i < tok.length; i++) {
    const ch = tok[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '"' && depth === 0) break;
  }
  const text = unbrace(tok.slice(1, i));
  let rest = tok.slice(i + 1).trim();
  let side = 'left';
  if (rest.startsWith("'")) { side = 'right'; rest = rest.slice(1).trim(); }
  if (rest.startsWith('{')) rest = unbrace(rest);
  if (/\bdescription\b/.test(rest)) side = 'over';
  if (/\bswap\b/.test(rest)) side = side === 'right' ? 'left' : 'right';
  return { text, side, rest };
}

function parseArrow(optsText, oldArgs) {
  const a = {
    dir: '', from: null, to: null, label: '', side: 'left', extra: [], phantom: false,
    tail: 'none', head: 'to', body: 'solid', double: false, bend: 0, looseness: 1, shift: null, loop: null, labels: [],
  };
  let loopIn = null, loopOut = null;
  for (let tok of splitTop(optsText, ',', { quotes: true })) {
    tok = tok.trim();
    if (!tok) continue;
    if (/^[rlud]+$/.test(tok)) { a.dir = tok; continue; }
    if (tok.startsWith('"')) { a.labels.push(parseLabelOption(tok)); continue; }
    const m = /^([^=]+?)\s*(?:=\s*(.*))?$/.exec(tok);
    const k = m ? m[1].trim() : tok;
    const v = m && m[2] !== undefined ? m[2].trim() : null;
    switch (k) {
      case 'from': a.from = v; break;
      case 'to': a.to = v; break;
      case 'hook': case 'hook\'': case 'hookrightarrow': a.tail = k === "hook'" ? "hook'" : 'hook'; break;
      case 'tail': case '2tail': case 'rightarrowtail': a.tail = 'mono'; break;
      case 'maps to': case 'mapsto': a.tail = 'mapsto'; break;
      case 'two heads': case 'twoheadrightarrow': a.head = 'epi'; break;
      case 'no head': case 'dash': case '-': a.head = 'none'; break;
      case 'harpoon': case "harpoon'": a.head = k; break;
      case 'dashed': case 'dashrightarrow': a.body = 'dashed'; break;
      case 'dotted': a.body = 'dotted'; break;
      case 'squiggly': case 'rightsquigarrow': a.body = 'squiggly'; break;
      case 'Rightarrow': case 'Leftarrow': a.double = true; break;
      case 'nfold': break;
      case 'draw': if (v === 'none') a.phantom = true; else a.extra.push(tok); break;
      case 'equal': case 'equals': case 'Equal': a.double = true; a.head = 'none'; break;
      case 'bend left': a.bend = v ? parseFloat(v) || 30 : 30; break;
      case 'looseness': a.looseness = parseFloat(v) || 1; break;
      case 'bend right': a.bend = -(v ? parseFloat(v) || 30 : 30); break;
      case 'shift left': case 'shift right': {
        const n = v === null ? 1 : /^-?[\d.]+$/.test(v) ? parseFloat(v) : NaN;
        if (Number.isFinite(n)) a.shift = (k === 'shift left' ? 1 : -1) * n;
        else a.extra.push(tok);
        break;
      }
      case 'phantom': a.phantom = true; break;
      case 'loop': a.loop = a.loop ?? 90; break;
      case 'loop above': a.loop = 90; break;
      case 'loop below': a.loop = 270; break;
      case 'loop left': a.loop = 180; break;
      case 'loop right': a.loop = 0; break;
      case 'in': loopIn = parseFloat(v); break;
      case 'out': loopOut = parseFloat(v); break;
      case 'distance': case 'very near start': case 'near start': case 'labels': break;
      case 'description': for (const l of a.labels) l.side = 'over'; break;
      case 'swap': for (const l of a.labels) l.side = l.side === 'right' ? 'left' : 'right'; break;
      case 'curve': {
        // quiver: curve={height=12pt}; positive height bows to the right.
        const h = /height\s*=\s*(-?[\d.]+)/.exec(v || '');
        if (h) a.bend = -Math.max(-90, Math.min(90, Math.round(parseFloat(h[1]) * 1.25 / 15) * 15));
        break;
      }
      default: a.extra.push(tok);
    }
  }
  if (oldArgs.length) {
    // Old syntax: \arrow{r}{f} or \arrow[style]{r}{f}
    if (!a.dir && /^[rlud]+$/.test(oldArgs[0].trim())) a.dir = oldArgs[0].trim();
    if (oldArgs[1] && oldArgs[1].trim()) a.labels.push({ text: oldArgs[1].trim(), side: 'left', rest: '' });
  }
  if (Number.isFinite(loopIn) && Number.isFinite(loopOut)) {
    let mid = (loopIn + loopOut) / 2;
    if (Math.abs(loopIn - loopOut) > 180) mid += 180;
    a.loop = mod360(mid);
  }
  const main = a.labels[0];
  if (main) { a.label = main.text; a.side = main.side; }
  return a;
}

export function parseTikzCD(src) {
  const warnings = [];
  let body = stripComments(src);
  const begin = body.search(/\\begin\s*\{tikzcd\}/);
  if (begin >= 0) {
    body = body.slice(begin).replace(/^\\begin\s*\{tikzcd\}/, '');
    if (/^\s*\[/.test(body)) {
      const i = body.indexOf('[');
      const [, after] = readBalanced(body, i, '[', ']');
      body = body.slice(after);
    }
    const end = body.search(/\\end\s*\{tikzcd\}/);
    if (end >= 0) body = body.slice(0, end);
  }
  // xymatrix-style \ar is accepted as \arrow.
  const rows = splitTop(body, '\\\\');
  const cells = []; // {col,row,label,arrows}
  const rowAdjust = [], colAdjust = []; // spacing tweaks in em: \\[Δ] and &[Δ] (first row only, as in TikZ)
  rows.forEach((rowText, r) => {
    rowText = rowText.replace(/^\s*\[([^\]]*)\]/, (_, dim) => { if (r > 0) rowAdjust[r - 1] = toEm(dim); return ''; });
    splitTop(rowText, '&').forEach((cellText, c) => {
      if (c > 0) cellText = cellText.replace(/^\[([^\]]*)\]/, (_, dim) => { if (r === 0) colAdjust[c - 1] = toEm(dim); return ''; });
      const arrows = [];
      let label = '';
      let i = 0;
      while (i < cellText.length) {
        const m = /^\\ar(?:row)?(?![A-Za-z])/.exec(cellText.slice(i));
        if (m) {
          i += m[0].length;
          let opts = '';
          while (/\s/.test(cellText[i] || '')) i++;
          if (cellText[i] === '[') {
            const [inner, after] = readBalanced(cellText, i, '[', ']');
            opts = inner;
            i = after;
          }
          const old = [];
          for (let k = 0; k < 2; k++) {
            let j = i;
            while (/\s/.test(cellText[j] || '')) j++;
            if (cellText[j] !== '{') break;
            const [inner, after] = readBalanced(cellText, j, '{', '}');
            old.push(inner);
            i = after;
          }
          arrows.push(parseArrow(opts, old));
          continue;
        }
        if (cellText[i] === '\\') { label += cellText.slice(i, i + 2); i += 2; continue; }
        label += cellText[i++];
      }
      const rawLabel = label.replace(/\|\[[^\]]*\]\|/g, '').trim();
      label = unbrace(rawLabel);
      // "{}" marks an empty cell that still holds an object (a spacer or an arrow end).
      cells.push({ col: c, row: r, label, arrows, empty: rawLabel === '{}' });
    });
  });

  // Work in matrix coordinates first, then turn spacing tweaks back into cell positions.
  const objects = new Map(); // "col,row" → {col,row,label}
  const object = (col, row) => {
    const k = `${col},${row}`;
    if (!objects.has(k)) objects.set(k, { col, row, label: '' });
    return objects.get(k);
  };
  for (const cell of cells) {
    if (cell.label) object(cell.col, cell.row).label = cell.label;
    else if (cell.empty) object(cell.col, cell.row);
  }
  const parseRef = (ref) => {
    const m = /^\s*\{?(\d+)\s*-\s*(\d+)\}?\s*$/.exec(ref || '');
    return m ? { row: +m[1] - 1, col: +m[2] - 1 } : null;
  };
  const arrows = [];
  for (const cell of cells) {
    for (const a of cell.arrows) {
      let src = { col: cell.col, row: cell.row };
      if (a.from) {
        const p = parseRef(a.from);
        if (!p) { warnings.push(`from=${a.from}`); continue; }
        src = p;
      }
      let dst;
      if (a.to) {
        dst = parseRef(a.to);
        if (!dst) { warnings.push(`to=${a.to}`); continue; }
      } else {
        const count = (ch) => (a.dir.match(new RegExp(ch, 'g')) || []).length;
        dst = { col: src.col + count('r') - count('l'), row: src.row + count('d') - count('u') };
      }
      arrows.push({ a, from: object(src.col, src.row), to: object(dst.col, dst.row) });
    }
  }
  const position = (adjust, pitch) => (i) => {
    let x = 0;
    for (let k = 0; k < i; k++) x += adjust[k] ? Math.max(0.25, snapQ(1 + adjust[k] / pitch)) : 1;
    return i < 0 ? i : x;
  };
  const px = position(colAdjust, GRID_PITCH.col), py = position(rowAdjust, GRID_PITCH.row);
  const nodes = [...objects.values()].map((o, i) => {
    o.id = `n${i + 1}`;
    return { id: o.id, col: px(o.col), row: py(o.row), label: o.label };
  });
  const edges = arrows.map(({ a, from, to }, i) => {
    const corner = a.phantom && /\\(lr|ul|ll|ur)corner/.test(a.label);
    return {
      id: `e${i + 1}`,
      from: from.id,
      to: to.id,
      label: corner ? '' : a.label,
      side: a.side,
      head: a.head,
      tail: a.tail,
      body: a.body,
      double: a.double,
      bend: a.bend,
      looseness: a.looseness,
      shift: a.shift,
      loop: a.loop ?? EDGE_DEFAULTS.loop,
      kind: corner ? 'corner' : a.phantom ? 'phantom' : 'arrow',
      extra: a.extra,
    };
  });
  return { diagram: new Diagram({ nodes, edges }), warnings };
}

// A TeX dimension in em (10pt text: 1em = 10pt, 1ex ≈ 0.43em).
function toEm(dim) {
  const m = /^\s*([+-]?[\d.]+)\s*([a-z]*)\s*$/.exec(dim || '');
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const per = { em: 1, ex: 0.43, pt: 0.1, bp: 0.1004, mm: 0.2845, cm: 2.845, in: 7.227, pc: 1.2 }[m[2] || 'em'];
  return per ? v * per : 0;
}
