// tikz-cd export and import.

import { Diagram, EDGE_DEFAULTS } from './model.js';

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
  return t.includes('&') ? `{${t}}` : t;
}

const fmt = (n) => String(Math.round(n * 100) / 100);

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
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  // Cells that must exist: every object plus the targets of corner marks.
  const need = [];
  for (const n of d.nodes) need.push({ col: n.col, row: n.row });
  for (const e of d.edges) {
    if (e.kind === 'corner') {
      const t = byId.get(e.to);
      if (t) need.push({ col: t.col, row: t.row });
    }
  }
  const c0 = Math.min(...need.map((c) => c.col));
  const r0 = Math.min(...need.map((c) => c.row));
  const r1 = Math.max(...need.map((c) => c.row));

  const content = new Map(); // "row,col" → text
  const key = (col, row) => `${row},${col}`;
  for (const n of d.nodes) content.set(key(n.col, n.row), cellLabel(n.label));
  for (const e of d.edges) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) continue;
    const k = key(from.col, from.row);
    const arrow = `\\arrow[${arrowOptions(e, from, to, shifts.get(e.id) || 0).join(', ')}]`;
    const prev = content.get(k) || '';
    content.set(k, prev ? `${prev} ${arrow}` : arrow);
  }
  // An empty cell that is the end of an arrow needs "{}" so tikz-cd creates its node.
  for (const c of need) {
    const k = key(c.col, c.row);
    if (!content.get(k)) content.set(k, '{}');
  }

  const lines = [];
  for (let r = r0; r <= r1; r++) {
    const cols = need.filter((c) => c.row === r).map((c) => c.col);
    if (!cols.length) { lines.push(''); continue; }
    const last = Math.max(...cols);
    const cells = [];
    for (let c = c0; c <= last; c++) cells.push(content.get(key(c, r)) || '');
    lines.push(cells.join(' & ').replace(/^\s+/, '').replace(/\s+&/g, ' &').replace(/^ &/, '&'));
  }
  const body = lines.map((l, i) => indent + l + (i < lines.length - 1 ? (l ? ' \\\\' : '\\\\') : '')).join('\n');
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
    tail: 'none', head: 'to', body: 'solid', double: false, bend: 0, shift: null, loop: null, labels: [],
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
  rows.forEach((rowText, r) => {
    rowText = rowText.replace(/^\s*\[[^\]]*\]/, ''); // \\[2em]
    splitTop(rowText, '&').forEach((cellText, c) => {
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

  const d = new Diagram();
  const nodeAt = (col, row, create) => {
    let n = d.nodeAt(col, row);
    if (!n && create) n = d.addNode(col, row, '');
    return n;
  };
  for (const cell of cells) {
    if (cell.label) nodeAt(cell.col, cell.row, true).label = cell.label;
    else if (cell.empty) nodeAt(cell.col, cell.row, true);
  }
  const parseRef = (ref) => {
    const m = /^\s*\{?(\d+)\s*-\s*(\d+)\}?\s*$/.exec(ref || '');
    return m ? { row: +m[1] - 1, col: +m[2] - 1 } : null;
  };
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
      const from = nodeAt(src.col, src.row, true);
      const to = nodeAt(dst.col, dst.row, true);
      const corner = a.phantom && /\\(lr|ul|ll|ur)corner/.test(a.label);
      const props = {
        label: corner ? '' : a.label,
        side: a.side,
        head: a.head,
        tail: a.tail,
        body: a.body,
        double: a.double,
        bend: a.bend,
        shift: a.shift,
        loop: a.loop ?? EDGE_DEFAULTS.loop,
        kind: corner ? 'corner' : a.phantom ? 'phantom' : 'arrow',
        extra: a.extra,
      };
      d.addEdge(from.id, to.id, props);
    }
  }
  return { diagram: d, warnings };
}
